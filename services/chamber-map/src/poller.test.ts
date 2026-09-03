import { describe, expect, it } from "vitest";
import { nextStalenessTransition } from "./poller.js";

const HOUR_MS = 60 * 60 * 1000;

// map.traccar_poll_failing only fires on actual HTTP failures - this covers
// the other failure mode, where every poll keeps succeeding (200 OK) while
// the device itself has simply stopped sending real fixes.
describe("nextStalenessTransition", () => {
  it("stays quiet while the gap is under the threshold", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, false)).toBeNull();
  });

  it("fires became_stale the first tick the gap reaches the threshold", () => {
    expect(nextStalenessTransition(12 * HOUR_MS, 12 * HOUR_MS, false)).toBe("became_stale");
    expect(nextStalenessTransition(13 * HOUR_MS, 12 * HOUR_MS, false)).toBe("became_stale");
  });

  it("does not re-fire on every subsequent still-stale tick", () => {
    expect(nextStalenessTransition(20 * HOUR_MS, 12 * HOUR_MS, true)).toBeNull();
  });

  it("fires became_fresh once the gap drops back under the threshold", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, true)).toBe("became_fresh");
  });

  it("does not re-fire became_fresh once already cleared", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, false)).toBeNull();
  });
});
