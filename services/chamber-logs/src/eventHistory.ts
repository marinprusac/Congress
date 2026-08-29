import { eq, and, desc, lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { eventHistory, eventSettings } from "./db/schema.js";
import type { EventHistoryEntry } from "./types.js";

// Used when an event type's own historyRetentionMs is unset - a durable
// record is exactly the thing Congress's own (short-lived) event switch
// isn't meant to be, so this defaults much longer than that log's own
// default.
const DEFAULT_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

function toEntry(row: typeof eventHistory.$inferSelect, label: string): EventHistoryEntry {
  return {
    id: row.id,
    label,
    chamber: row.chamber,
    type: row.type,
    payload: JSON.parse(row.payloadJson),
    occurredAt: row.occurredAt.toISOString(),
  };
}

// Append-only - see db/schema.ts's eventHistory for why this never upserts
// the way pushNotification does. `retentionMs` comes from the recording
// event type's own historyRetentionMs (falling back to the default above),
// same "computed once at write time" pattern as Congress's own
// events.expiresAt.
export function recordHistory(opts: {
  chamber: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  retentionMs: number | null;
}): void {
  db.insert(eventHistory)
    .values({
      chamber: opts.chamber,
      type: opts.type,
      payloadJson: JSON.stringify(opts.payload),
      occurredAt: opts.occurredAt,
      expiresAt: new Date(opts.occurredAt.getTime() + (opts.retentionMs ?? DEFAULT_HISTORY_RETENTION_MS)),
    })
    .run();
}

// Powers both the history list/detail pages and the "recent-logs" widget.
// Joined against eventSettings for each entry's own display label (a
// settings row is never deleted, but the join is still a left-join-shaped
// best-effort in case a row's own event type has since gone stale).
export function listHistory(opts: { eventType?: string; limit?: number } = {}): EventHistoryEntry[] {
  const limit = opts.limit ?? LIST_LIMIT;
  const conditions = [opts.eventType !== undefined ? eq(eventHistory.type, opts.eventType) : undefined].filter(
    (c) => c !== undefined
  );
  const rows = db
    .select({ history: eventHistory, label: eventSettings.label })
    .from(eventHistory)
    .leftJoin(eventSettings, eq(eventHistory.type, eventSettings.eventType))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(eventHistory.occurredAt))
    .limit(limit)
    .all();
  return rows.map((row) => toEntry(row.history, row.label ?? row.history.type));
}

export function pruneOldHistory(): number {
  return db.delete(eventHistory).where(lt(eventHistory.expiresAt, new Date())).run().changes;
}

// Retention here can be as short as a few minutes (an event type's own
// historyRetentionMs), same reasoning as Congress's own event prune sweep -
// an infrequent sweep would let a short-retention row sit around well past
// its own expiresAt.
const HISTORY_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

let historyPruneInterval: ReturnType<typeof setInterval> | undefined;

export function startHistoryPruneSweep(): void {
  historyPruneInterval = setInterval(() => {
    pruneOldHistory();
  }, HISTORY_PRUNE_INTERVAL_MS);
}

export function stopHistoryPruneSweep(): void {
  if (historyPruneInterval) clearInterval(historyPruneInterval);
}
