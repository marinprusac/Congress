// Self-rescheduling sync loop: one sync at a time, the interval re-read after
// every run, and a manual sync resetting the countdown.

export interface SyncStatus {
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  nextSyncAt: string | null;
}

export interface SchedulerOptions {
  // Resolves to an error message when the sync (partly) failed, else null.
  sync: () => Promise<string | null>;
  intervalMs: () => number;
}

export function createSyncScheduler(options: SchedulerOptions) {
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

  function arm(): void {
    if (!running || inFlight) return;
    clearTimer();
    const ms = options.intervalMs();
    nextSyncAt = new Date(Date.now() + ms);
    timer = setTimeout(() => void syncNow(), ms);
    timer.unref?.();
  }

  async function runOnce(): Promise<void> {
    try {
      lastError = await options.sync();
    } catch (err) {
      lastError = (err as Error).message;
    }
    lastSyncedAt = new Date();
  }

  // Joins a sync already under way rather than starting a second one.
  async function syncNow(): Promise<SyncStatus> {
    if (!inFlight) {
      clearTimer();
      inFlight = runOnce().finally(() => {
        inFlight = null;
      });
      await inFlight;
      arm();
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
    // After an interval change: restart the countdown from now.
    reschedule(): void {
      arm();
    },
    syncNow,
    status,
  };
}
