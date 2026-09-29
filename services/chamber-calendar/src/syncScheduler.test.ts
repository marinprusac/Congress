import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler } from "./syncScheduler.js";

const MINUTE = 60_000;

function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs on start, then again after the configured interval", async () => {
    const sync = vi.fn(async () => null);
    const scheduler = createSyncScheduler({ sync, intervalMs: async () => 5 * MINUTE });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("picks up a changed interval on reschedule, counting from now", async () => {
    let interval = 30 * MINUTE;
    const sync = vi.fn(async () => null);
    const scheduler = createSyncScheduler({ sync, intervalMs: async () => interval });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    interval = MINUTE;
    await scheduler.reschedule();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(sync).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("a manual sync resets the countdown", async () => {
    const sync = vi.fn(async () => null);
    const scheduler = createSyncScheduler({ sync, intervalMs: async () => 5 * MINUTE });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);

    await scheduler.syncNow();
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(sync).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("joins a sync already in flight instead of starting a second one", async () => {
    const pending = deferred();
    const sync = vi.fn(() => pending.promise);
    const scheduler = createSyncScheduler({ sync, intervalMs: async () => 5 * MINUTE });
    scheduler.start();
    expect(scheduler.status().syncing).toBe(true);

    const manual = scheduler.syncNow();
    pending.resolve(null);
    const status = await manual;
    expect(sync).toHaveBeenCalledTimes(1);
    expect(status.syncing).toBe(false);
    expect(status.lastSyncedAt).not.toBeNull();
    scheduler.stop();
  });

  it("records reported and thrown errors, and clears them on the next clean sync", async () => {
    const results: Array<() => Promise<string | null>> = [
      async () => "primary: boom",
      async () => {
        throw new Error("network down");
      },
      async () => null,
    ];
    const scheduler = createSyncScheduler({ sync: () => results.shift()!(), intervalMs: async () => MINUTE });

    expect((await scheduler.syncNow()).lastError).toBe("primary: boom");
    expect((await scheduler.syncNow()).lastError).toBe("network down");
    expect((await scheduler.syncNow()).lastError).toBeNull();
  });

  it("runs the post-sync hook after every sync, even a failed one", async () => {
    const onSynced = vi.fn();
    const scheduler = createSyncScheduler({ sync: async () => "err", intervalMs: async () => MINUTE, onSynced });
    await scheduler.syncNow();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling after stop()", async () => {
    const sync = vi.fn(async () => null);
    const scheduler = createSyncScheduler({ sync, intervalMs: async () => MINUTE });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    expect(scheduler.status().nextSyncAt).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
