import { describe, expect, it } from "vitest";
import { nextRunAt, type DirectiveScheduleFields } from "./scheduling.js";

const CREATED_AT = new Date("2026-01-01T00:00:00.000Z").getTime();

function fields(overrides: Partial<DirectiveScheduleFields>): DirectiveScheduleFields {
  return {
    scheduleType: null,
    intervalMs: null,
    scheduleHour: null,
    scheduleMinute: null,
    scheduleDayOfWeek: null,
    scheduleTimeZone: null,
    ...overrides,
  };
}

describe("nextRunAt", () => {
  it("returns null for a manual-only (no schedule) directive", () => {
    expect(nextRunAt(fields({ scheduleType: null }), null, CREATED_AT)).toBeNull();
  });

  it("returns null for an event-triggered directive - it never runs off this timer", () => {
    expect(nextRunAt(fields({ scheduleType: "event" }), null, CREATED_AT)).toBeNull();
  });

  it("interval: a never-run directive is due immediately (anchored at epoch 0)", () => {
    const due = nextRunAt(fields({ scheduleType: "interval", intervalMs: 60_000 }), null, CREATED_AT);
    expect(due).toBe(60_000);
  });

  it("interval: a run directive is due intervalMs after its last run", () => {
    const lastRunAt = CREATED_AT + 5_000;
    const due = nextRunAt(fields({ scheduleType: "interval", intervalMs: 60_000 }), lastRunAt, CREATED_AT);
    expect(due).toBe(lastRunAt + 60_000);
  });

  it("daily: schedules the next occurrence after creation, not immediately", () => {
    // Created 2026-01-01T00:00:00Z, schedule "09:00 UTC" - should land later
    // the same day, not fire right away.
    const due = nextRunAt(fields({ scheduleType: "daily", scheduleHour: 9, scheduleMinute: 0, scheduleTimeZone: "UTC" }), null, CREATED_AT);
    expect(new Date(due as number).toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });

  it("daily: rolls to the next day once today's time has already passed", () => {
    const afterToday = new Date("2026-01-01T10:00:00.000Z").getTime();
    const due = nextRunAt(fields({ scheduleType: "daily", scheduleHour: 9, scheduleMinute: 0, scheduleTimeZone: "UTC" }), afterToday, CREATED_AT);
    expect(new Date(due as number).toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("daily: strictly after the anchor, so an exact-match instant rolls to the next day", () => {
    const exactMatch = new Date("2026-01-01T09:00:00.000Z").getTime();
    const due = nextRunAt(fields({ scheduleType: "daily", scheduleHour: 9, scheduleMinute: 0, scheduleTimeZone: "UTC" }), exactMatch, CREATED_AT);
    expect(new Date(due as number).toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("daily: honors a non-UTC time zone's own wall clock", () => {
    // 09:00 in America/New_York (UTC-5 in January, no DST) is 14:00 UTC.
    const due = nextRunAt(
      fields({ scheduleType: "daily", scheduleHour: 9, scheduleMinute: 0, scheduleTimeZone: "America/New_York" }),
      null,
      CREATED_AT
    );
    expect(new Date(due as number).toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });

  it("weekly: lands on the requested day-of-week, not just the next matching time", () => {
    // 2026-01-01 is a Thursday (weekday 4). Ask for Wednesday (3) at 09:00 UTC.
    const due = nextRunAt(
      fields({ scheduleType: "weekly", scheduleHour: 9, scheduleMinute: 0, scheduleDayOfWeek: 3, scheduleTimeZone: "UTC" }),
      null,
      CREATED_AT
    );
    const result = new Date(due as number);
    expect(result.getUTCDay()).toBe(3);
    expect(result.toISOString()).toBe("2026-01-07T09:00:00.000Z");
  });

  it("weekly: picks the same day later today when it's already that weekday and the time hasn't passed", () => {
    // 2026-01-01 is a Thursday - ask for Thursday at 23:00 UTC, anchored at 00:00 UTC that day.
    const due = nextRunAt(
      fields({ scheduleType: "weekly", scheduleHour: 23, scheduleMinute: 0, scheduleDayOfWeek: 4, scheduleTimeZone: "UTC" }),
      null,
      CREATED_AT
    );
    expect(new Date(due as number).toISOString()).toBe("2026-01-01T23:00:00.000Z");
  });

  it("weekly: rolls a full week forward once this week's slot has passed", () => {
    const afterThisWeeksSlot = new Date("2026-01-01T10:00:00.000Z").getTime();
    const due = nextRunAt(
      fields({ scheduleType: "weekly", scheduleHour: 9, scheduleMinute: 0, scheduleDayOfWeek: 4, scheduleTimeZone: "UTC" }),
      afterThisWeeksSlot,
      CREATED_AT
    );
    expect(new Date(due as number).toISOString()).toBe("2026-01-08T09:00:00.000Z");
  });
});
