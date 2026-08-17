import { eq, lt, and } from "drizzle-orm";
import { eventLogResponseSchema, type EventLogEntry } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pollerState, automationRuns } from "./db/schema.js";
import { env } from "./env.js";
import { listEnabledAutomationsForTrigger, markAutomationFired } from "./automations.js";
import { pushNotification } from "./notifications.js";

const POLL_INTERVAL_MS = 30_000;
const RUNS_PER_AUTOMATION = 20;

const POLLER_ID = 1;

function getCursor(): number {
  const row = db.select().from(pollerState).where(eq(pollerState.id, POLLER_ID)).get();
  return row?.lastEventId ?? 0;
}

function setCursor(id: number): void {
  const existing = db.select().from(pollerState).where(eq(pollerState.id, POLLER_ID)).get();
  if (existing) {
    db.update(pollerState).set({ lastEventId: id }).where(eq(pollerState.id, POLLER_ID)).run();
  } else {
    db.insert(pollerState).values({ id: POLLER_ID, lastEventId: id }).run();
  }
}

async function fetchEventsSince(since: number): Promise<{ events: EventLogEntry[]; cursor: number }> {
  const res = await fetch(`${env.CAPITOL_URL}/congress/events?since=${since}`, {
    headers: { "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Congress returned ${res.status}`);
  return eventLogResponseSchema.parse(await res.json());
}

// Reads a dotted path ("a.b.c") out of a plain object, returning undefined
// for any missing/non-object segment - used by both the condition check and
// template interpolation below.
function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

// v1's only condition shape: an optional single-field exact-match filter
// beyond the event type match already selecting this automation. No
// expression language by design - see automations table's own comment.
function conditionMatches(automation: { conditionField: string | null; conditionEquals: string | null }, payload: Record<string, unknown>): boolean {
  if (!automation.conditionField) return true;
  const value = getPath(payload, automation.conditionField);
  return String(value ?? "") === (automation.conditionEquals ?? "");
}

// Plain {{payload.x}}/{{payload.a.b}} interpolation - no templating library,
// no arbitrary expressions, just a dotted-path lookup against the firing
// event's own payload.
function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*payload\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(payload, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

function recordRun(automationId: number, eventId: number, payload: Record<string, unknown>, resultTitle: string | null, resultBody: string | null): void {
  db.insert(automationRuns)
    .values({
      automationId,
      eventId,
      payloadJson: JSON.stringify(payload),
      resultTitle,
      resultBody,
      firedAt: new Date(),
    })
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
    db.delete(automationRuns)
      .where(and(eq(automationRuns.automationId, automationId), lt(automationRuns.firedAt, cutoff)))
      .run();
  }
}

async function runAutomation(automation: ReturnType<typeof listEnabledAutomationsForTrigger>[number], event: EventLogEntry): Promise<void> {
  if (!conditionMatches(automation, event.payload)) return;

  const dedupeKey = interpolate(automation.actionDedupeKeyTemplate, event.payload);

  // Required at the request-schema level (createAutomationRequestSchema),
  // but that only guards creation - fall back to the automation's own title
  // so a since-edited automation missing its template still produces a
  // visible (if generic) notification rather than a blank one.
  const title = automation.actionTitleTemplate ? interpolate(automation.actionTitleTemplate, event.payload) : automation.title;
  const body = automation.actionBodyTemplate ? interpolate(automation.actionBodyTemplate, event.payload) : undefined;
  const chamberUrl = automation.actionUrlTemplate ? interpolate(automation.actionUrlTemplate, event.payload) : undefined;
  // Preserve the original emitting chamber's identity (e.g. "tasks") so
  // the notification bell attributes/icons it correctly - this Chamber
  // is just the one deciding whether/what to push, not the source.
  pushNotification({ chamber: event.chamber, dedupeKey, title, body, chamberUrl });
  recordRun(automation.id, event.id, event.payload, title, body ?? null);

  await markAutomationFired(automation.id);
}

async function poll(): Promise<void> {
  const since = getCursor();
  let batch: { events: EventLogEntry[]; cursor: number };
  try {
    batch = await fetchEventsSince(since);
  } catch (err) {
    console.warn(`Event poll failed: ${(err as Error).message}`);
    return;
  }

  for (const event of batch.events) {
    const matches = listEnabledAutomationsForTrigger(event.type);
    for (const automation of matches) {
      try {
        await runAutomation(automation, event);
      } catch (err) {
        console.warn(`Automation ${automation.id} failed on event ${event.id}: ${(err as Error).message}`);
      }
    }
  }

  if (batch.cursor !== since) setCursor(batch.cursor);
}

let pollInterval: ReturnType<typeof setInterval> | undefined;

export function startEventPoller(): void {
  void poll();
  pollInterval = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

export function stopEventPoller(): void {
  if (pollInterval) clearInterval(pollInterval);
}
