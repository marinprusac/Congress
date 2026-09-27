import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../../../src/types";
import { buildTimeline, buildWeek, isTentative, startOfWeek, type TimelineEntry } from "./calendarViews";

let nextId = 0;

// Plain (offset-less) ISO strings throughout - parsed as local time, the same
// as the local-midnight day bounds the layout computes, so fixtures stay
// consistent whatever zone runs the tests.
function makeEvent(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "start" | "end">): CalendarEvent {
  nextId += 1;
  return {
    id: `evt-${nextId}`,
    accountId: 1,
    calendarId: "cal-1",
    calendarSummary: "Test",
    calendarColor: null,
    title: `Event ${nextId}`,
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

const ms = (iso: string) => new Date(iso).getTime();
const titles = (entries: TimelineEntry[]) => entries.map((e) => (e.kind === "now" ? "NOW" : e.event.title));

describe("buildTimeline", () => {
  const from = new Date("2030-01-07T00:00:00");

  it("lists days in order, skips empty ones but always keeps today", () => {
    const days = buildTimeline(
      [
        makeEvent({ title: "Thu", start: "2030-01-10T09:00:00", end: "2030-01-10T10:00:00" }),
        makeEvent({ title: "Tue", start: "2030-01-08T09:00:00", end: "2030-01-08T10:00:00" }),
      ],
      { from, days: 7, nowMs: ms("2030-01-07T12:00:00") }
    );
    expect(days.map((d) => d.dateKey)).toEqual(["2030-01-07", "2030-01-08", "2030-01-10"]);
    expect(days[0]!.isToday).toBe(true);
    expect(titles(days[0]!.entries)).toEqual(["NOW"]);
  });

  it("places the now line before the first event that hasn't started, and flags past/ongoing", () => {
    const [today] = buildTimeline(
      [
        makeEvent({ title: "Later", start: "2030-01-07T15:00:00", end: "2030-01-07T16:00:00" }),
        makeEvent({ title: "Morning", start: "2030-01-07T08:00:00", end: "2030-01-07T09:00:00" }),
        makeEvent({ title: "Lunch", start: "2030-01-07T12:00:00", end: "2030-01-07T13:00:00" }),
      ],
      { from, days: 1, nowMs: ms("2030-01-07T12:30:00") }
    );
    expect(titles(today!.entries)).toEqual(["Morning", "Lunch", "NOW", "Later"]);
    const [morning, lunch] = today!.entries;
    expect(morning).toMatchObject({ past: true, ongoing: false });
    expect(lunch).toMatchObject({ past: false, ongoing: true });
  });

  it("lists an overnight event once, on the day it starts", () => {
    const days = buildTimeline([makeEvent({ title: "Sleep", start: "2030-01-08T23:00:00", end: "2030-01-09T07:00:00" })], {
      from,
      days: 7,
      nowMs: ms("2030-01-07T12:00:00"),
    });
    expect(days.map((d) => d.dateKey)).toEqual(["2030-01-07", "2030-01-08"]);
    expect(titles(days[1]!.entries)).toEqual(["Sleep"]);
  });

  it("puts an event still running from before the window on the first day", () => {
    const [first] = buildTimeline([makeEvent({ title: "Trip", start: "2030-01-05T10:00:00", end: "2030-01-08T10:00:00" })], {
      from,
      days: 3,
      nowMs: ms("2030-01-07T12:00:00"),
    });
    expect(titles(first!.entries)).toEqual(["Trip", "NOW"]);
  });

  it("shows an all-day event on every day it covers (end date exclusive)", () => {
    const days = buildTimeline([makeEvent({ title: "Conf", allDay: true, start: "2030-01-08", end: "2030-01-10" })], {
      from,
      days: 7,
      nowMs: ms("2030-01-01T12:00:00"),
    });
    expect(days.map((d) => d.dateKey)).toEqual(["2030-01-08", "2030-01-09"]);
    expect(days.every((d) => d.allDay.length === 1 && d.entries.length === 0)).toBe(true);
  });
});

describe("startOfWeek", () => {
  it("returns Monday midnight", () => {
    expect(startOfWeek(new Date("2030-01-10T15:00:00"))).toEqual(new Date("2030-01-07T00:00:00"));
    expect(startOfWeek(new Date("2030-01-13T23:00:00"))).toEqual(new Date("2030-01-07T00:00:00"));
    expect(startOfWeek(new Date("2030-01-07T00:00:00"))).toEqual(new Date("2030-01-07T00:00:00"));
  });
});

describe("buildWeek", () => {
  const monday = new Date("2030-01-07T00:00:00");

  it("returns seven days with events at their clock position", () => {
    const week = buildWeek([makeEvent({ start: "2030-01-09T09:30:00", end: "2030-01-09T11:00:00" })], monday);
    expect(week.map((d) => d.dateKey)).toEqual([
      "2030-01-07",
      "2030-01-08",
      "2030-01-09",
      "2030-01-10",
      "2030-01-11",
      "2030-01-12",
      "2030-01-13",
    ]);
    expect(week[2]!.blocks).toMatchObject([{ startMin: 570, endMin: 660, column: 0, columns: 1 }]);
  });

  it("clips an overnight event into both days", () => {
    const week = buildWeek([makeEvent({ start: "2030-01-07T22:00:00", end: "2030-01-08T02:00:00" })], monday);
    expect(week[0]!.blocks).toMatchObject([{ startMin: 1320, endMin: 1440 }]);
    expect(week[1]!.blocks).toMatchObject([{ startMin: 0, endMin: 120 }]);
  });

  it("puts overlapping events side by side and reuses freed columns", () => {
    const [day] = buildWeek(
      [
        makeEvent({ title: "Long", start: "2030-01-07T09:00:00", end: "2030-01-07T12:00:00" }),
        makeEvent({ title: "A", start: "2030-01-07T09:30:00", end: "2030-01-07T10:00:00" }),
        makeEvent({ title: "B", start: "2030-01-07T10:30:00", end: "2030-01-07T11:00:00" }),
        makeEvent({ title: "Alone", start: "2030-01-07T14:00:00", end: "2030-01-07T15:00:00" }),
      ],
      monday
    );
    const byTitle = Object.fromEntries(day!.blocks.map((b) => [b.event.title, [b.column, b.columns]]));
    expect(byTitle).toEqual({ Long: [0, 2], A: [1, 2], B: [1, 2], Alone: [0, 1] });
  });

  it("treats back-to-back events as not overlapping", () => {
    const [day] = buildWeek(
      [
        makeEvent({ start: "2030-01-07T09:00:00", end: "2030-01-07T10:00:00" }),
        makeEvent({ start: "2030-01-07T10:00:00", end: "2030-01-07T11:00:00" }),
      ],
      monday
    );
    expect(day!.blocks.map((b) => b.columns)).toEqual([1, 1]);
  });

  it("gives very short events enough room that their boxes don't collide", () => {
    const [day] = buildWeek(
      [
        makeEvent({ start: "2030-01-07T09:00:00", end: "2030-01-07T09:05:00" }),
        makeEvent({ start: "2030-01-07T09:10:00", end: "2030-01-07T09:15:00" }),
      ],
      monday
    );
    expect(day!.blocks.map((b) => [b.column, b.columns])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("lists all-day events on each day they cover", () => {
    const week = buildWeek([makeEvent({ allDay: true, start: "2030-01-12", end: "2030-01-14" })], monday);
    expect(week.map((d) => d.allDay.length)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });
});

describe("isTentative", () => {
  it("is true for unanswered/tentative invitations and not-attending events", () => {
    const base = { start: "2030-01-07T09:00:00", end: "2030-01-07T10:00:00" };
    expect(isTentative(makeEvent(base))).toBe(false);
    expect(isTentative(makeEvent({ ...base, attendance: { isInvitation: true, responseStatus: "needsAction", notAttending: false } }))).toBe(true);
    expect(isTentative(makeEvent({ ...base, attendance: { isInvitation: true, responseStatus: "accepted", notAttending: false } }))).toBe(false);
    expect(isTentative(makeEvent({ ...base, attendance: { isInvitation: false, responseStatus: null, notAttending: true } }))).toBe(true);
  });
});
