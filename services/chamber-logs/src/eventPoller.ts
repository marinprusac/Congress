import { eq } from "drizzle-orm";
import { eventLogResponseSchema, priorityLevelSchema, type EventLogEntry, type PriorityLevel } from "@congress/shared-types";
import { db } from "./db/client.js";
import { pollerState } from "./db/schema.js";
import { env } from "./env.js";
import { listEnabledLogRulesForTrigger, markLogRuleFired } from "./logRules.js";
import { pushNotification } from "./notifications.js";
import { recordHistory, priorityRankFor } from "./eventHistory.js";

const POLL_INTERVAL_MS = 30_000;

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
// for any missing/non-object segment - used by the condition check,
// priority extraction, and template interpolation below.
function getPath(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

// v1's only equality condition shape: an optional single-field exact-match
// filter beyond the event type match already selecting this rule. No
// expression language by design - see logRules table's own comment.
function conditionMatches(rule: { conditionField: string | null; conditionEquals: string | null }, payload: Record<string, unknown>): boolean {
  if (!rule.conditionField) return true;
  const value = getPath(payload, rule.conditionField);
  return String(value ?? "") === (rule.conditionEquals ?? "");
}

// payload.priority is a convention (PRIORITY_LEVELS, shared-types), not
// enforced by Congress - anything missing or unrecognized defaults to
// "normal" rather than rejecting the event.
function priorityOf(payload: Record<string, unknown>): PriorityLevel {
  const parsed = priorityLevelSchema.safeParse(payload.priority);
  return parsed.success ? parsed.data : "normal";
}

// ">=" is deliberately the only comparison minPriority supports - see
// logRules table's own comment.
function minPriorityMatches(rule: { minPriority: PriorityLevel | null }, priority: PriorityLevel): boolean {
  if (!rule.minPriority) return true;
  return priorityRankFor(priority) >= priorityRankFor(rule.minPriority);
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

async function runRule(rule: ReturnType<typeof listEnabledLogRulesForTrigger>[number], event: EventLogEntry): Promise<void> {
  if (!conditionMatches(rule, event.payload)) return;
  const priority = priorityOf(event.payload);
  if (!minPriorityMatches(rule, priority)) return;

  if (rule.recordToHistory) {
    recordHistory({
      ruleId: rule.id,
      chamber: event.chamber,
      type: event.type,
      priority,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
      retentionMs: rule.historyRetentionMs,
    });
  }

  if (rule.notify) {
    // The dedupe key template is an optional field the owner rarely fills
    // in - default to a key scoped to this rule so repeat firings still
    // update the one notification in place instead of colliding with
    // another rule's own default-keyed notification for the same chamber.
    const dedupeKey = rule.notifyDedupeKeyTemplate ? interpolate(rule.notifyDedupeKeyTemplate, event.payload) : `rule-${rule.id}`;
    const title = rule.notifyTitleTemplate ? interpolate(rule.notifyTitleTemplate, event.payload) : rule.title;
    const body = rule.notifyBodyTemplate ? interpolate(rule.notifyBodyTemplate, event.payload) : undefined;
    const chamberUrl = rule.notifyUrlTemplate ? interpolate(rule.notifyUrlTemplate, event.payload) : undefined;
    // Preserve the original emitting chamber's identity (e.g. "tasks") so
    // the notification bell attributes/icons it correctly - this Chamber
    // is just the one deciding whether/what to push, not the source.
    pushNotification({ chamber: event.chamber, dedupeKey, title, body, chamberUrl });
  }

  await markLogRuleFired(rule.id);
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
    const matches = listEnabledLogRulesForTrigger(event.type);
    for (const rule of matches) {
      try {
        await runRule(rule, event);
      } catch (err) {
        console.warn(`Log rule ${rule.id} failed on event ${event.id}: ${(err as Error).message}`);
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
