import { describe, expect, it } from "vitest";
import { directiveProgressFraction } from "./directiveProgress.js";

describe("directiveProgressFraction", () => {
  it("returns null for a directive with no periodic schedule (nextRunAt null)", () => {
    expect(directiveProgressFraction(null, null, "2026-01-01T00:00:00.000Z", null, Date.now())).toBeNull();
  });

  it("interval: anchors on lastRunAt, unaffected by scheduleCycleStart being absent", () => {
    const lastRunAt = "2026-01-01T09:00:00.000Z";
    const nextRunAt = "2026-01-01T10:00:00.000Z"; // 1h interval
    const halfway = new Date("2026-01-01T09:30:00.000Z").getTime();
    expect(directiveProgressFraction(lastRunAt, nextRunAt, "2026-01-01T00:00:00.000Z", null, halfway)).toBeCloseTo(0.5, 5);
  });

  it("interval: never run falls back to createdAt", () => {
    const createdAt = "2026-01-01T09:00:00.000Z";
    const nextRunAt = "2026-01-01T09:00:00.000Z"; // due immediately (epoch-anchored)
    expect(directiveProgressFraction(null, nextRunAt, createdAt, null, Date.now())).toBe(1);
  });

  it("daily: uses scheduleCycleStart, not createdAt, for a never-run directive", () => {
    // Directive created only an hour before its own next occurrence - the
    // old createdAt-anchored math would show this as a near-instant cycle
    // (almost 0% -> 100% within that one hour) instead of reflecting the
    // true daily rhythm.
    const createdAt = "2026-01-01T08:00:00.000Z";
    const scheduleCycleStart = "2025-12-31T09:00:00.000Z"; // yesterday at 9am
    const nextRunAt = "2026-01-01T09:00:00.000Z"; // today at 9am
    const now = new Date("2026-01-01T08:00:00.000Z").getTime(); // 23h after cycle start
    const fraction = directiveProgressFraction(null, nextRunAt, createdAt, scheduleCycleStart, now);
    expect(fraction).toBeCloseTo(23 / 24, 5);
  });

  it("daily: ignores an off-schedule lastRunAt (manual run) in favor of scheduleCycleStart", () => {
    const scheduleCycleStart = "2026-01-01T09:00:00.000Z";
    const nextRunAt = "2026-01-02T09:00:00.000Z";
    const lastRunAt = "2026-01-01T15:00:00.000Z"; // manual run, off the 9am schedule
    const sixHoursIn = new Date("2026-01-01T15:00:00.000Z").getTime();
    const fraction = directiveProgressFraction(lastRunAt, nextRunAt, "2025-12-01T00:00:00.000Z", scheduleCycleStart, sixHoursIn);
    expect(fraction).toBeCloseTo(6 / 24, 5);
  });

  it("clamps to 1 once past due, and to 0 before the cycle start", () => {
    const scheduleCycleStart = "2026-01-01T09:00:00.000Z";
    const nextRunAt = "2026-01-02T09:00:00.000Z";
    const wayPast = new Date("2026-01-03T00:00:00.000Z").getTime();
    const beforeStart = new Date("2026-01-01T00:00:00.000Z").getTime();
    expect(directiveProgressFraction(null, nextRunAt, "2025-12-01T00:00:00.000Z", scheduleCycleStart, wayPast)).toBe(1);
    expect(directiveProgressFraction(null, nextRunAt, "2025-12-01T00:00:00.000Z", scheduleCycleStart, beforeStart)).toBe(0);
  });
});
