import { eq, and, desc, gte, lt } from "drizzle-orm";
import { PRIORITY_LEVELS, type PriorityLevel } from "@congress/shared-types";
import { db } from "./db/client.js";
import { eventHistory, logRules } from "./db/schema.js";
import type { EventHistoryEntry } from "./types.js";

// Used when a rule's own historyRetentionMs is unset - a durable record is
// exactly the thing Congress's own (short-lived) event switch isn't meant
// to be, so this defaults much longer than that log's own default.
const DEFAULT_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

export function priorityRankFor(level: PriorityLevel | undefined): number {
  const rank = PRIORITY_LEVELS.indexOf(level ?? "normal");
  return rank === -1 ? PRIORITY_LEVELS.indexOf("normal") : rank;
}

function priorityLevelFor(rank: number): PriorityLevel {
  return PRIORITY_LEVELS[rank] ?? "normal";
}

function toEntry(row: typeof eventHistory.$inferSelect, ruleTitle: string): EventHistoryEntry {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleTitle,
    chamber: row.chamber,
    type: row.type,
    priority: priorityLevelFor(row.priorityRank),
    payload: JSON.parse(row.payloadJson),
    occurredAt: row.occurredAt.toISOString(),
  };
}

// Append-only - see db/schema.ts's eventHistory for why this never upserts
// the way pushNotification does. `retentionMs` comes from the recording
// rule's own historyRetentionMs (falling back to the default above), same
// "computed once at write time" pattern as Congress's own events.expiresAt.
export function recordHistory(opts: {
  ruleId: number;
  chamber: string;
  type: string;
  priority: PriorityLevel;
  payload: Record<string, unknown>;
  occurredAt: Date;
  retentionMs: number | null;
}): void {
  db.insert(eventHistory)
    .values({
      ruleId: opts.ruleId,
      chamber: opts.chamber,
      type: opts.type,
      priorityRank: priorityRankFor(opts.priority),
      payloadJson: JSON.stringify(opts.payload),
      occurredAt: opts.occurredAt,
      expiresAt: new Date(opts.occurredAt.getTime() + (opts.retentionMs ?? DEFAULT_HISTORY_RETENTION_MS)),
    })
    .run();
}

// Powers both the history list page and the "recent-logs"/"urgent-logs"
// widgets - `minPriority` set means "urgent-logs" (a real >= query against
// priorityRank, not an app-level filter), unset means "recent-logs".
// Joined against logRules for each entry's own rule title (a rule can be
// deleted later without deleting the history it already wrote, so this is a
// left-join-shaped best-effort, not a hard foreign key).
export function listHistory(opts: { minPriority?: PriorityLevel; ruleId?: number; limit?: number } = {}): EventHistoryEntry[] {
  const limit = opts.limit ?? LIST_LIMIT;
  const conditions = [
    opts.minPriority ? gte(eventHistory.priorityRank, priorityRankFor(opts.minPriority)) : undefined,
    opts.ruleId !== undefined ? eq(eventHistory.ruleId, opts.ruleId) : undefined,
  ].filter((c) => c !== undefined);
  const rows = db
    .select({ history: eventHistory, ruleTitle: logRules.title })
    .from(eventHistory)
    .leftJoin(logRules, eq(eventHistory.ruleId, logRules.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(eventHistory.occurredAt))
    .limit(limit)
    .all();
  return rows.map((row) => toEntry(row.history, row.ruleTitle ?? "(deleted rule)"));
}

export function pruneOldHistory(): number {
  return db.delete(eventHistory).where(lt(eventHistory.expiresAt, new Date())).run().changes;
}

// Retention here can be as short as a few minutes (a rule's own
// historyRetentionMs), same reasoning as Congress's own event prune sweep -
// an infrequent sweep would let a short-retention rule's rows sit around
// well past their own expiresAt.
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
