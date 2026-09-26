import { lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { pendingCheckupEvents } from "./db/schema.js";

// Safety net, not the normal path: pending_checkup_events is drained on
// every directive's own scheduled tick (checkup.ts) and should never
// actually reach this age - this only matters if the AI has been paused for
// a long stretch, so the buffer doesn't grow unboundedly in the meantime.
// (Chat messages and spend moved to Congress along with the AI engine, and
// are swept there.)
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PENDING_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sweep(): void {
  db.delete(pendingCheckupEvents).where(lt(pendingCheckupEvents.occurredAt, new Date(Date.now() - PENDING_EVENT_MAX_AGE_MS))).run();
}

let sweepInterval: ReturnType<typeof setInterval> | undefined;

export function startRetentionSweep(): void {
  sweep();
  sweepInterval = setInterval(sweep, SWEEP_INTERVAL_MS);
}

export function stopRetentionSweep(): void {
  if (sweepInterval) clearInterval(sweepInterval);
}
