import { lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiMessages, aiSpend } from "../db/schema.js";
import { getAiSettings } from "./settings.js";

// Time-based sweep of chat messages and spend rows, owner-configurable via
// aiSettings.retentionDays. Every 6h is plenty for a 30-day-default window.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function sweepAiRetention(now = Date.now()): Promise<void> {
  const settings = await getAiSettings();
  const cutoff = new Date(now - settings.retentionDays * 24 * 60 * 60 * 1000);
  db.delete(aiSpend).where(lt(aiSpend.createdAt, cutoff)).run();
  db.delete(aiMessages).where(lt(aiMessages.createdAt, cutoff)).run();
}

let sweepInterval: ReturnType<typeof setInterval> | undefined;

export function startAiRetentionSweep(): void {
  void sweepAiRetention();
  sweepInterval = setInterval(() => void sweepAiRetention(), SWEEP_INTERVAL_MS);
}

export function stopAiRetentionSweep(): void {
  if (sweepInterval) clearInterval(sweepInterval);
}
