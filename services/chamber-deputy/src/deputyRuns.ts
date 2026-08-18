import { desc, eq, gte } from "drizzle-orm";
import { db } from "./db/client.js";
import { deputyRuns } from "./db/schema.js";
import type { DeputyRun, DeputyRunTrigger, DeputyTranscriptEntry } from "./types.js";

function toRun(row: typeof deputyRuns.$inferSelect): DeputyRun {
  return {
    id: row.id,
    trigger: row.trigger,
    sessionId: row.sessionId,
    prompt: row.prompt,
    transcript: JSON.parse(row.transcriptJson) as DeputyTranscriptEntry[],
    finalResponse: row.finalResponse,
    ok: row.ok,
    errorMessage: row.errorMessage,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RecordRunInput {
  trigger: DeputyRunTrigger;
  sessionId: string | null;
  prompt: string;
  transcript: DeputyTranscriptEntry[];
  finalResponse: string | null;
  ok: boolean;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

export function recordRun(input: RecordRunInput): number {
  const inserted = db
    .insert(deputyRuns)
    .values({
      trigger: input.trigger,
      sessionId: input.sessionId,
      prompt: input.prompt,
      transcriptJson: JSON.stringify(input.transcript),
      finalResponse: input.finalResponse,
      ok: input.ok,
      errorMessage: input.errorMessage,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
      durationMs: input.durationMs,
      createdAt: new Date(),
    })
    .returning({ id: deputyRuns.id })
    .get();
  return inserted.id;
}

const RECENT_RUNS_LIMIT = 20;

export async function listRecentRuns(limit = RECENT_RUNS_LIMIT): Promise<DeputyRun[]> {
  const rows = db.select().from(deputyRuns).orderBy(desc(deputyRuns.createdAt)).limit(limit).all();
  return rows.map(toRun);
}

export async function getRun(id: number): Promise<DeputyRun | null> {
  const row = db.select().from(deputyRuns).where(eq(deputyRuns.id, id)).get();
  return row ? toRun(row) : null;
}

// Sum of today's run costs (calendar day, server-local time) - what
// engine.ts checks against settings.budgetCapUsd before spawning another
// `claude` process. Rows with a null cost (a run that crashed before the
// CLI ever emitted its final `result` event) count as 0, not unknown - a
// failed run can't have spent more than whatever the CLI itself reported.
export async function todaySpendUsd(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = db.select({ costUsd: deputyRuns.costUsd }).from(deputyRuns).where(gte(deputyRuns.createdAt, start)).all();
  return rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
}
