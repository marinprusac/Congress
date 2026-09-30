import { describe, expect, it } from "vitest";
import { allDayRange, describeRange, lastDay, localDate, localMidnight, minutesBetween, moveStart, toggleAllDay } from "./timeRange";

describe("time ranges", () => {
  it("moves the start and keeps the length", () => {
    const start = "2026-10-01T07:00:00.000Z";
    expect(moveStart(start, "2026-10-01T08:30:00.000Z", "2026-10-02T07:00:00.000Z")).toEqual({
      start: "2026-10-02T07:00:00.000Z",
      end: "2026-10-02T08:30:00.000Z",
    });
    expect(moveStart(null, null, start).end).toBe("2026-10-01T08:00:00.000Z");
    expect(minutesBetween(start, start)).toBeNull();
  });

  it("keeps whole days as local midnights with an exclusive end", () => {
    const r = allDayRange("2026-10-01", "2026-10-03");
    expect(localDate(r.start)).toBe("2026-10-01");
    expect(r.end).toBe(localMidnight("2026-10-04"));
    expect(lastDay(r.start, r.end)).toBe("2026-10-03");
    // An end before the start is one day.
    expect(allDayRange("2026-10-05", "2026-10-01").end).toBe(localMidnight("2026-10-06"));
    expect(lastDay(r.start, r.start)).toBe("2026-10-01");
  });

  it("switches between timed and all day on the same day", () => {
    const timed = { start: localMidnight("2026-10-01"), end: localMidnight("2026-10-01") };
    const nine = toggleAllDay(timed.start, timed.end, false);
    expect(localDate(nine.start)).toBe("2026-10-01");
    expect(new Date(nine.start).getHours()).toBe(9);
    expect(minutesBetween(nine.start, nine.end)).toBe(60);
    const day = toggleAllDay(nine.start, nine.end, true);
    expect(day).toEqual(allDayRange("2026-10-01", "2026-10-01"));
  });

  it("describes a range", () => {
    expect(describeRange(null, null, false)).toBe("—");
    expect(describeRange(localMidnight("2026-10-01"), localMidnight("2026-10-02"), true)).toMatch(/all day$/);
    expect(describeRange(localMidnight("2026-10-01"), localMidnight("2026-10-03"), true)).toContain("–");
  });
});
