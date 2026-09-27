import { describe, expect, it } from "vitest";
import { decidePush, inQuietHours, startOfLocalDay } from "./pushPolicy.js";

const utc = (iso: string) => new Date(`${iso}Z`);

describe("inQuietHours", () => {
  it("wraps past midnight", () => {
    expect(inQuietHours(utc("2026-09-27T23:30:00"), 22, 7, "UTC")).toBe(true);
    expect(inQuietHours(utc("2026-09-27T06:59:00"), 22, 7, "UTC")).toBe(true);
    expect(inQuietHours(utc("2026-09-27T07:00:00"), 22, 7, "UTC")).toBe(false);
  });

  it("handles a same-day window and disabled hours", () => {
    expect(inQuietHours(utc("2026-09-27T13:00:00"), 12, 14, "UTC")).toBe(true);
    expect(inQuietHours(utc("2026-09-27T13:00:00"), null, 14, "UTC")).toBe(false);
    expect(inQuietHours(utc("2026-09-27T13:00:00"), 5, 5, "UTC")).toBe(false);
  });

  it("uses the configured time zone", () => {
    // 21:30 UTC is 23:30 in Zagreb (CEST).
    expect(inQuietHours(utc("2026-09-27T21:30:00"), 22, 7, "Europe/Zagreb")).toBe(true);
    expect(inQuietHours(utc("2026-09-27T21:30:00"), 22, 7, "UTC")).toBe(false);
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight", () => {
    expect(startOfLocalDay(utc("2026-09-27T15:42:10.500"), "UTC").toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(startOfLocalDay(utc("2026-09-27T15:42:10"), "Europe/Zagreb").toISOString()).toBe("2026-09-26T22:00:00.000Z");
  });
});

describe("decidePush", () => {
  const base = { at: utc("2026-09-27T12:00:00"), pushedToday: 0, maxPushesPerDay: 3, quietHoursStart: 22, quietHoursEnd: 7, timeZone: "UTC" };

  it("pushes an urgent ask within budget", () => {
    expect(decidePush({ ...base, urgency: "push" })).toBe("push");
  });

  it("downgrades over the daily cap, in quiet hours, or when quiet", () => {
    expect(decidePush({ ...base, urgency: "push", pushedToday: 3 })).toBe("over_cap");
    expect(decidePush({ ...base, urgency: "push", at: utc("2026-09-27T23:00:00") })).toBe("quiet_hours");
    expect(decidePush({ ...base, urgency: "quiet" })).toBe("quiet");
  });
});
