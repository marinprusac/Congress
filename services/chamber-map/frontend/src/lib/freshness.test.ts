import { describe, expect, it } from "vitest";
import { trackingFreshness } from "./freshness.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("trackingFreshness", () => {
  it("says nothing when no fix has ever been recorded", () => {
    expect(trackingFreshness(null, NOW)).toBeNull();
  });

  it("says nothing for an unparseable timestamp rather than rendering NaN", () => {
    expect(trackingFreshness("not a date", NOW)).toBeNull();
  });

  it("stays quiet while the newest fix is recent", () => {
    expect(trackingFreshness(agoMs(5 * MIN), NOW)).toBeNull();
    expect(trackingFreshness(agoMs(19 * MIN), NOW)).toBeNull();
  });

  it("reads a device clock running ahead of the server as fresh, not as negative lag", () => {
    expect(trackingFreshness(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBeNull();
  });

  it("speaks up once the lag crosses the noteworthy bound", () => {
    expect(trackingFreshness(agoMs(20 * MIN), NOW)?.label).toBe("Location is 20 min old");
  });

  it("switches to hours past the hour mark", () => {
    expect(trackingFreshness(agoMs(HOUR), NOW)?.label).toBe("Location is 1h old");
    expect(trackingFreshness(agoMs(3 * HOUR + 24 * MIN), NOW)?.label).toBe("Location is 3h 24m old");
  });

  it("switches to days past a day", () => {
    expect(trackingFreshness(agoMs(24 * HOUR), NOW)?.label).toBe("Location is 1d old");
    expect(trackingFreshness(agoMs(38 * HOUR + 42 * MIN), NOW)?.label).toBe("Location is 1d 14h old");
  });

  it("carries the raw lag alongside the label", () => {
    expect(trackingFreshness(agoMs(90 * MIN), NOW)?.lagMs).toBe(90 * MIN);
  });
});
