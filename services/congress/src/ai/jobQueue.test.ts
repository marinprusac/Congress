import { describe, expect, it } from "vitest";
import { cancelJob, enqueue, JobCancelledError, PRIORITY, queueSnapshot } from "./jobQueue.js";

const entry = (runId: string) => ({ runId, kind: "chat", threadId: null, meta: {} });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("jobQueue", () => {
  it("runs one job at a time, higher priority first, FIFO within a priority", async () => {
    const gate = deferred();
    const order: string[] = [];
    const first = enqueue(async () => {
      order.push("first");
      await gate.promise;
    }, { entry: entry("first"), priority: PRIORITY.gate });
    const low = enqueue(async () => void order.push("low"), { entry: entry("low"), priority: PRIORITY.proactive });
    const highA = enqueue(async () => void order.push("highA"), { entry: entry("highA") });
    const highB = enqueue(async () => void order.push("highB"), { entry: entry("highB") });

    expect(queueSnapshot().running?.runId).toBe("first");
    expect(queueSnapshot().waiting.map((e) => e.runId)).toEqual(["highA", "highB", "low"]);
    gate.resolve();
    await Promise.all([first, low, highA, highB]);

    expect(order).toEqual(["first", "highA", "highB", "low"]);
    expect(queueSnapshot()).toEqual({ running: null, waiting: [] });
  });

  it("drops a queued job with JobCancelledError", async () => {
    const gate = deferred();
    const running = enqueue(() => gate.promise, { entry: entry("busy") });
    const queued = enqueue(async () => "never", { entry: entry("queued") });

    expect(cancelJob("queued")).toBe("queued");
    await expect(queued).rejects.toBeInstanceOf(JobCancelledError);
    gate.resolve();
    await running;
  });

  it("aborts the running job's signal", async () => {
    let aborted = false;
    const job = enqueue(
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
      { entry: entry("live") }
    );

    expect(cancelJob("live")).toBe("running");
    await job;
    await new Promise((r) => setTimeout(r, 0));
    expect(aborted).toBe(true);
    expect(cancelJob("live")).toBeNull();
  });

  it("keeps draining after a job throws", async () => {
    const failing = enqueue(async () => {
      throw new Error("boom");
    }, { entry: entry("bad") });
    const next = enqueue(async () => "ok", { entry: entry("good") });

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
