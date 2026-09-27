import { desc, eq, inArray } from "drizzle-orm";
import type { AiActivityEntry, AiMessageRun, AiRunDetail, AiRunStatus } from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiRuns } from "../db/schema.js";

// The ai_runs audit trail: one row per run, written at start and finish.
export function insertRunRow(row: {
  id: string;
  threadId: number | null;
  kind: string;
  trigger: string | null;
  actor: string;
  model: string | null;
  status: AiRunStatus;
  errorMessage?: string | null;
}): void {
  db.insert(aiRuns)
    .values({ ...row, errorMessage: row.errorMessage ?? null, startedAt: new Date(), finishedAt: row.status === "running" ? null : new Date() })
    .run();
}

export function finishRunRow(
  id: string,
  result: {
    status: AiRunStatus;
    errorMessage: string | null;
    costUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
    activity: AiActivityEntry[];
    verdict?: unknown;
  }
): void {
  db.update(aiRuns)
    .set({
      status: result.status,
      errorMessage: result.errorMessage,
      finishedAt: new Date(),
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      toolCallCount: result.activity.filter((a) => a.type === "tool").length,
      activityJson: JSON.stringify(result.activity),
      verdictJson: result.verdict === undefined ? null : JSON.stringify(result.verdict),
    })
    .where(eq(aiRuns.id, id))
    .run();
}

// Anything still "running" at boot was cut off by a restart.
export function markInterruptedRuns(): void {
  db.update(aiRuns)
    .set({ status: "error", errorMessage: "Interrupted by a restart.", finishedAt: new Date() })
    .where(eq(aiRuns.status, "running"))
    .run();
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toDetail(row: typeof aiRuns.$inferSelect): AiRunDetail {
  return {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind,
    trigger: row.trigger,
    actor: row.actor,
    model: row.model,
    status: row.status,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    costUsd: row.costUsd,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    toolCallCount: row.toolCallCount,
    activity: parseJson<AiActivityEntry[]>(row.activityJson, []),
    verdict: parseJson<unknown>(row.verdictJson, null),
  };
}

export function getRunDetail(id: string): AiRunDetail | null {
  const row = db.select().from(aiRuns).where(eq(aiRuns.id, id)).get();
  return row ? toDetail(row) : null;
}

export function listRecentRuns(limit = 50): AiRunDetail[] {
  return db.select().from(aiRuns).orderBy(desc(aiRuns.startedAt)).limit(limit).all().map(toDetail);
}

// Light summaries for a page of messages, keyed by run id.
export function runSummaries(ids: string[]): Map<string, AiMessageRun> {
  const out = new Map<string, AiMessageRun>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: aiRuns.id,
      status: aiRuns.status,
      toolCallCount: aiRuns.toolCallCount,
      durationMs: aiRuns.durationMs,
      costUsd: aiRuns.costUsd,
    })
    .from(aiRuns)
    .where(inArray(aiRuns.id, ids))
    .all();
  for (const row of rows) out.set(row.id, row);
  return out;
}
