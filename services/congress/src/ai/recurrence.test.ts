import { describe, expect, it } from "vitest";
import { describeRecurrence, nextOccurrenceAfter } from "./recurrence.js";

const at = (iso: string) => new Date(iso).getTime();

describe("nextOccurrenceAfter", () => {
  it("adds an interval", () => {
    expect(nextOccurrenceAfter({ type: "interval", everyMinutes: 90 }, at("2026-09-27T10:00:00Z"), "UTC")).toBe(at("2026-09-27T11:30:00Z"));
  });

  it("finds the next daily slot in the owner's zone, later today or tomorrow", () => {
    // 09:00 in Zagreb (CEST, UTC+2) is 07:00 UTC.
    expect(nextOccurrenceAfter({ type: "daily", hour: 9, minute: 0 }, at("2026-09-27T05:00:00Z"), "Europe/Zagreb")).toBe(at("2026-09-27T07:00:00Z"));
    expect(nextOccurrenceAfter({ type: "daily", hour: 9, minute: 0 }, at("2026-09-27T07:00:00Z"), "Europe/Zagreb")).toBe(at("2026-09-28T07:00:00Z"));
  });

  it("finds the next weekly slot on the right weekday", () => {
    // 2026-09-27 is a Sunday; next Wednesday 18:30 UTC is 2026-09-30.
    expect(nextOccurrenceAfter({ type: "weekly", dayOfWeek: 3, hour: 18, minute: 30 }, at("2026-09-27T12:00:00Z"), "UTC")).toBe(at("2026-09-30T18:30:00Z"));
  });

  it("handles a DST change (Zagreb leaves CEST on 2026-10-25)", () => {
    expect(nextOccurrenceAfter({ type: "daily", hour: 9, minute: 0 }, at("2026-10-25T01:00:00Z"), "Europe/Zagreb")).toBe(at("2026-10-25T08:00:00Z"));
  });
});

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence({ type: "interval", everyMinutes: 120 })).toBe("every 2 hours");
    expect(describeRecurrence({ type: "daily", hour: 7, minute: 5 })).toBe("daily at 07:05");
    expect(describeRecurrence({ type: "weekly", dayOfWeek: 1, hour: 9, minute: 0 })).toBe("every Monday at 09:00");
  });
});
