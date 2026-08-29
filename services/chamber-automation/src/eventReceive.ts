import { eq, lt, and } from "drizzle-orm";
import type { EventDelivery } from "@congress/shared-types";
// getPath/interpolate are shared with chamber-logs rather than duplicated
// here - see chamber-kit's eventMatching.ts.
import { fetchRegistry, callChamberTool, getPath, interpolate } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { automationRuns } from "./db/schema.js";
import { env } from "./env.js";
import { listEnabledAutomationsForTrigger, markAutomationFired } from "./automations.js";
import { publishEvent } from "./events.js";

const RUNS_PER_AUTOMATION = 20;

// v1's only condition shape: an optional single-field exact-match filter
// beyond the event type match already selecting this automation. No
// expression language by design - see automations table's own comment.
export function conditionMatches(automation: { conditionField: string | null; conditionEquals: string | null }, payload: Record<string, unknown>): boolean {
  if (!automation.conditionField) return true;
  const value = getPath(payload, automation.conditionField);
  return String(value ?? "") === (automation.conditionEquals ?? "");
}

// Each argument's interpolated string is JSON.parsed when that succeeds -
// see db/schema.ts's automations table comment for why this is the only
// coercion beyond plain interpolation.
export function buildArgs(argsTemplate: Record<string, string>, payload: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(argsTemplate)) {
    const interpolated = interpolate(template, payload);
    try {
      args[key] = JSON.parse(interpolated);
    } catch {
      args[key] = interpolated;
    }
  }
  return args;
}

function recordRun(
  automationId: number,
  payload: Record<string, unknown>,
  targetChamber: string,
  toolName: string,
  ok: boolean,
  resultJson: string | null,
  errorMessage: string | null
): void {
  db.insert(automationRuns)
    .values({ automationId, payloadJson: JSON.stringify(payload), targetChamber, toolName, ok, resultJson, errorMessage, firedAt: new Date() })
    .run();

  // Prune to the newest RUNS_PER_AUTOMATION rows for this automation - see
  // db/schema.ts's own comment on automationRuns for why this is pruned on
  // insert rather than a timer.
  const keep = db
    .select({ id: automationRuns.id, firedAt: automationRuns.firedAt })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(automationRuns.firedAt)
    .all();
  if (keep.length > RUNS_PER_AUTOMATION) {
    const cutoff = keep[keep.length - RUNS_PER_AUTOMATION]!.firedAt;
    db.delete(automationRuns).where(and(eq(automationRuns.automationId, automationId), lt(automationRuns.firedAt, cutoff))).run();
  }
}

async function runAutomation(automation: ReturnType<typeof listEnabledAutomationsForTrigger>[number], event: EventDelivery): Promise<void> {
  if (!conditionMatches(automation, event.payload)) return;

  let registry;
  try {
    registry = await fetchRegistry(env.CAPITOL_URL, env.CONGRESS_INTERNAL_TOKEN);
  } catch (err) {
    console.warn(`Registry fetch failed: ${(err as Error).message}`);
    return;
  }

  const target = registry.find((c) => c.name === automation.targetChamber);
  if (!target || !target.mcpUrl) {
    const errorMessage = `Chamber "${automation.targetChamber}" is not registered or has no MCP server`;
    recordRun(automation.id, event.payload, automation.targetChamber, automation.toolName, false, null, errorMessage);
    void publishEvent({
      type: "automation.run_failed",
      payload: {
        automationId: automation.id,
        title: automation.title,
        targetChamber: automation.targetChamber,
        toolName: automation.toolName,
        error: errorMessage,
      },
    });
    await markAutomationFired(automation.id);
    return;
  }

  const args = buildArgs(JSON.parse(automation.argsTemplateJson), event.payload);

  try {
    const result = await callChamberTool(target.mcpUrl, env.CONGRESS_INTERNAL_TOKEN, automation.toolName, args);
    recordRun(automation.id, event.payload, automation.targetChamber, automation.toolName, true, JSON.stringify(result), null);
    void publishEvent({
      type: "automation.run_succeeded",
      payload: {
        automationId: automation.id,
        title: automation.title,
        targetChamber: automation.targetChamber,
        toolName: automation.toolName,
      },
    });
  } catch (err) {
    const errorMessage = (err as Error).message;
    recordRun(automation.id, event.payload, automation.targetChamber, automation.toolName, false, null, errorMessage);
    void publishEvent({
      type: "automation.run_failed",
      payload: {
        automationId: automation.id,
        title: automation.title,
        targetChamber: automation.targetChamber,
        toolName: automation.toolName,
        error: errorMessage,
      },
    });
  }

  await markAutomationFired(automation.id);
}

// Handed to mountEventReceiveRoute (@congress/chamber-kit) - runs every
// enabled automation whose triggerEventType matches this one delivered
// event, same logic the old poll loop ran per batched event, just invoked
// directly per push instead of on a 30s tick.
export async function handleReceivedEvent(event: EventDelivery): Promise<void> {
  const matches = listEnabledAutomationsForTrigger(event.type);
  for (const automation of matches) {
    try {
      await runAutomation(automation, event);
    } catch (err) {
      console.warn(`Automation ${automation.id} failed on event ${event.chamber}.${event.type}: ${(err as Error).message}`);
    }
  }
}
