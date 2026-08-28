import { describe, expect, it } from "vitest";
import { getRunningDirectiveId, withRunningDirective } from "./runningState.js";

describe("runningState", () => {
  it("has no running directive before any run starts", () => {
    expect(getRunningDirectiveId()).toBeNull();
  });

  it("reports the directive as running only for the duration of its job", async () => {
    let observedWhileRunning: number | null = null;
    await withRunningDirective(7, async () => {
      observedWhileRunning = getRunningDirectiveId();
    });
    expect(observedWhileRunning).toBe(7);
    expect(getRunningDirectiveId()).toBeNull();
  });

  it("clears the running directive even when the job throws", async () => {
    await expect(
      withRunningDirective(9, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(getRunningDirectiveId()).toBeNull();
  });

  it("returns the job's own result", async () => {
    const result = await withRunningDirective(3, async () => "ok");
    expect(result).toBe("ok");
  });
});
