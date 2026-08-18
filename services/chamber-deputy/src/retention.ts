import { lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { deputyRuns, messages } from "./db/schema.js";
import { getSettings } from "./settings.js";

// Unlike automation_runs (pruned on insert, capped per-entity), deputy_runs/
// messages aren't naturally grouped under a stable per-entity foreign key to
// cap by count instead - so this is a time-based sweep, owner-configurable
// via settings.retentionDays (docs/deputy-chamber-plan.md §9). Every 6h is
// plenty for a 30-day-default window; not worth a tighter cadence.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function sweep(): Promise<void> {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000);
  db.delete(deputyRuns).where(lt(deputyRuns.createdAt, cutoff)).run();
  db.delete(messages).where(lt(messages.createdAt, cutoff)).run();
}

let sweepInterval: ReturnType<typeof setInterval> | undefined;

export function startRetentionSweep(): void {
  void sweep();
  sweepInterval = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
}

export function stopRetentionSweep(): void {
  if (sweepInterval) clearInterval(sweepInterval);
}
