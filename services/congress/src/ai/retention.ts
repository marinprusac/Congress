import { and, inArray, isNull, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiMessages, aiRuns, aiSpend, aiThreads } from "../db/schema.js";
import { getAiSettings } from "./settings.js";

// Time-based sweep, owner-configurable via aiSettings.retentionDays: spend and
// run rows by age, threads by last activity (pinned and running ones stay).
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function sweepAiRetention(now = Date.now()): Promise<void> {
  const settings = await getAiSettings();
  const cutoff = new Date(now - settings.retentionDays * 24 * 60 * 60 * 1000);
  db.delete(aiSpend).where(lt(aiSpend.createdAt, cutoff)).run();
  db.delete(aiRuns).where(lt(aiRuns.startedAt, cutoff)).run();
  const stale = db
    .select({ id: aiThreads.id })
    .from(aiThreads)
    .where(and(lt(aiThreads.lastMessageAt, cutoff), isNull(aiThreads.pinnedAt), isNull(aiThreads.pendingRunId)))
    .all()
    .map((r) => r.id);
  if (stale.length === 0) return;
  db.transaction((tx) => {
    tx.delete(aiMessages).where(inArray(aiMessages.threadId, stale)).run();
    tx.delete(aiThreads).where(inArray(aiThreads.id, stale)).run();
  });
}

let sweepInterval: ReturnType<typeof setInterval> | undefined;

export function startAiRetentionSweep(): void {
  void sweepAiRetention();
  sweepInterval = setInterval(() => void sweepAiRetention(), SWEEP_INTERVAL_MS);
}

export function stopAiRetentionSweep(): void {
  if (sweepInterval) clearInterval(sweepInterval);
}
