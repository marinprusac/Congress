import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../src/types";
import { buildAgendaTimeline } from "./datetime";
import type { AgendaClusterEntry, AgendaDateEntry, AgendaGapEntry } from "./datetime";

let nextId = 0;

// Deliberately plain (offset-less) ISO strings throughout this file - both
// dayKey() (slices event.start) and buildAgendaTimeline's own window-bound
// Date math treat those as local time, so fixtures and window bounds stay
// mutually consistent regardless of the machine's own time zone.
function makeEvent(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "start" | "end">): CalendarEvent {
  nextId += 1;
  return {
    id: `evt-${nextId}`,
    accountId: 1,
    calendarId: "cal-1",
    calendarSummary: "Test",
    calendarColor: null,
    title: "Event",
    description: null,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    ...partial,
  };
}

describe("buildAgendaTimeline - day visibility", () => {
  const windowStartMs = new Date("2030-01-01T00:00:00").getTime();
  const windowEndMs = new Date("2030-01-04T00:00:00").getTime(); // Jan 1, 2, 3
  const window = { nowMs: windowStartMs - 1, windowStartMs, windowEndMs };

  it("shows a weekday-labeled header for every day, including one with no events, with the true gap around it never compressed", () => {
    const events = [
      makeEvent({ start: "2030-01-01T09:00:00", end: "2030-01-01T10:00:00" }),
      // Jan 2 has no events at all.
      makeEvent({ start: "2030-01-03T09:00:00", end: "2030-01-03T10:00:00" }),
    ];

    const timeline = buildAgendaTimeline(events, window);

    const dateEntries = timeline.filter((e): e is AgendaDateEntry => e.kind === "date");
    expect(dateEntries.map((e) => e.key)).toEqual(["date-2030-01-01", "date-2030-01-02", "date-2030-01-03"]);
    for (const entry of dateEntries) {
      expect(entry.label).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    }

    // The full span from the first event's end to the second event's start -
    // which includes the entirety of the empty Jan 2 - is accounted for by
    // real "gap" entries, not silently dropped into a collapsed marker.
    const totalGapMinutes = timeline
      .filter((e): e is AgendaGapEntry => e.kind === "gap")
      .reduce((sum, e) => sum + e.minutes, 0);
    const expectedMinutes = Math.round(
      (new Date("2030-01-03T09:00:00").getTime() - new Date("2030-01-01T10:00:00").getTime()) / 60000
    );
    expect(totalGapMinutes).toBe(expectedMinutes);
  });

  it("carries a weekday name even for a day far beyond the old 7-day cutoff", () => {
    const timeline = buildAgendaTimeline([], window);
    const lastDate = timeline.filter((e): e is AgendaDateEntry => e.kind === "date").at(-1)!;
    expect(lastDate.key).toBe("date-2030-01-03");
    expect(lastDate.label).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
  });
});

describe("buildAgendaTimeline - overlap column assignment", () => {
  const windowStartMs = new Date("2030-02-01T00:00:00").getTime();
  const windowEndMs = new Date("2030-02-02T00:00:00").getTime();
  const window = { nowMs: windowStartMs - 1, windowStartMs, windowEndMs };

  it("splits into columns when two events substantially overlap", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T10:00:00" }), // 60 min
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T09:50:00" }), // 50 min, fully inside the first
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(2);
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(2);
    }
  });

  it("keeps both events full-width when they only slightly overlap", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T10:00:00" }), // 60 min
      makeEvent({ start: "2030-02-01T09:55:00", end: "2030-02-01T10:55:00" }), // 60 min, 5 min tail overlap
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(2);
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(1);
    }
  });

  it("lets two short events that don't overlap each other time-share a column even though both substantially overlap a longer one", () => {
    const events = [
      makeEvent({ start: "2030-02-01T09:00:00", end: "2030-02-01T11:00:00" }), // 2h, long
      makeEvent({ start: "2030-02-01T09:05:00", end: "2030-02-01T09:15:00" }), // nested near the start
      makeEvent({ start: "2030-02-01T10:50:00", end: "2030-02-01T11:00:00" }), // nested near the end
    ];

    const timeline = buildAgendaTimeline(events, window);
    const cluster = timeline.find((e): e is AgendaClusterEntry => e.kind === "cluster")!;
    expect(cluster.blocks).toHaveLength(3);
    // The long event needs its own column against both short ones; the two
    // short ones never overlap each other, so only 2 columns are needed
    // total, not 3.
    for (const block of cluster.blocks) {
      expect(block.columnCount).toBe(2);
    }
  });
});
