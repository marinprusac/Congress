import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler } from "./scheduler.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sync scheduler", () => {
  it("syncs on start, then every interval", async () => {
    const sync = vi.fn(async () => null);
    const s = createSyncScheduler({ sync, intervalMs: () => 1000 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(2);
    s.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("joins a sync in flight and keeps its error", async () => {
    let release!: () => void;
    const sync = vi.fn(() => new Promise<string | null>((r) => (release = () => r("partly failed"))));
    const s = createSyncScheduler({ sync, intervalMs: () => 1000 });
    s.start();
    const joined = s.syncNow();
    expect(s.status().syncing).toBe(true);
    release();
    const status = await joined;
    expect(sync).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ syncing: false, lastError: "partly failed" });
    expect(status.nextSyncAt).not.toBeNull();
    s.stop();
  });

  it("restarts the countdown on reschedule", async () => {
    let interval = 10_000;
    const sync = vi.fn(async () => null);
    const s = createSyncScheduler({ sync, intervalMs: () => interval });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    interval = 500;
    s.reschedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(sync).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it("records a thrown sync as the error", async () => {
    const s = createSyncScheduler({ sync: async () => { throw new Error("offline"); }, intervalMs: () => 1000 });
    expect((await s.syncNow()).lastError).toBe("offline");
  });
});
