import type { SyncStatus } from "./types.js";

export interface SyncSchedulerOptions {
  // Resolves to an error message when the sync (partly) failed, else null.
  sync: () => Promise<string | null>;
  intervalMs: () => Promise<number>;
  onSynced?: () => void;
}

// Self-rescheduling sync loop: one sync at a time, the interval re-read after
// every run, and a manual sync resetting the countdown.
export function createSyncScheduler(options: SyncSchedulerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextSyncAt: Date | null = null;
  let inFlight: Promise<void> | null = null;
  let running = false;
  let lastSyncedAt: Date | null = null;
  let lastError: string | null = null;

  function status(): SyncStatus {
    return {
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      lastError,
      syncing: inFlight !== null,
      nextSyncAt: nextSyncAt?.toISOString() ?? null,
    };
  }

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    nextSyncAt = null;
  }

  async function arm(): Promise<void> {
    const ms = await options.intervalMs();
    // A sync or stop() may have happened while the interval was read.
    if (!running || inFlight) return;
    clearTimer();
    nextSyncAt = new Date(Date.now() + ms);
    timer = setTimeout(() => void syncNow(), ms);
  }

  async function runOnce(): Promise<void> {
    try {
      lastError = await options.sync();
    } catch (err) {
      lastError = (err as Error).message;
    }
    lastSyncedAt = new Date();
    try {
      options.onSynced?.();
    } catch (err) {
      console.warn(`Calendar post-sync hook failed: ${(err as Error).message}`);
    }
  }

  // Joins a sync already under way rather than starting a second one.
  async function syncNow(): Promise<SyncStatus> {
    if (!inFlight) {
      clearTimer();
      inFlight = runOnce().finally(() => {
        inFlight = null;
      });
      await inFlight;
      if (running) await arm();
    } else {
      await inFlight;
    }
    return status();
  }

  return {
    start(): void {
      running = true;
      void syncNow();
    },
    stop(): void {
      running = false;
      clearTimer();
    },
    // After an interval change - restarts the countdown from now.
    async reschedule(): Promise<void> {
      if (running && !inFlight) await arm();
    },
    syncNow,
    status,
  };
}
