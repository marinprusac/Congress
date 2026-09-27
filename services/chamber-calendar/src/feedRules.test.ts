import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types.js";
import { calendarFeedCandidates } from "./feedRules.js";
import { toExhibitId } from "./google/eventId.js";

const now = new Date(2026, 8, 27, 14, 0, 0);
const MIN = 60 * 1000;

function event(id: string, startOffsetMin: number, durationMin: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    accountId: 1,
    calendarId: "primary",
    calendarSummary: "Me",
    calendarColor: null,
    title: `Event ${id}`,
    description: null,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    start: new Date(now.getTime() + startOffsetMin * MIN).toISOString(),
    end: new Date(now.getTime() + (startOffsetMin + durationMin) * MIN).toISOString(),
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    ...overrides,
  } as CalendarEvent;
}

const idOf = (id: string) => toExhibitId(1, "primary", id);

describe("calendarFeedCandidates", () => {
  it("surfaces an event in progress", () => {
    const items = calendarFeedCandidates([event("a", -10, 60)], now);
    expect(items).toMatchObject([{ kind: "exhibit", exhibitId: idOf("a"), score: 85, reason: "Happening now" }]);
  });

  it("ranks an event starting soon above one starting later", () => {
    const items = calendarFeedCandidates([event("later", 150, 30), event("soon", 25, 30)], now);
    const score = (id: string) => items.find((i) => i.kind === "exhibit" && i.exhibitId === idOf(id))!.score;
    expect(score("soon")).toBeGreaterThan(score("later"));
  });

  it("leaves out events far off, already over, or ones the owner isn't attending", () => {
    const items = calendarFeedCandidates(
      [event("far", 8 * 60, 30), event("past", -120, 30), event("declined", 20, 30, { attendance: { isInvitation: true, responseStatus: "declined", notAttending: true } })],
      now
    );
    expect(items.filter((i) => i.kind === "exhibit")).toEqual([]);
  });

  it("shows today's all-day events, not tomorrow's", () => {
    const items = calendarFeedCandidates(
      [
        event("today", 0, 0, { allDay: true, start: "2026-09-27", end: "2026-09-28" }),
        event("tomorrow", 0, 0, { allDay: true, start: "2026-09-28", end: "2026-09-29" }),
      ],
      now
    );
    expect(items).toMatchObject([{ kind: "exhibit", exhibitId: idOf("today"), score: 40, reason: "Today" }]);
    expect(items).toHaveLength(1);
  });

  it("shows the event's time, place, calendar and description inline", () => {
    const e = event("a", 20, 60, { location: "Dental clinic, Ilica 5", description: "Bring the **X-ray** from [[exhibit:documents:document-2|March]]" });
    const [item] = calendarFeedCandidates([e], now);
    expect(item).toMatchObject({
      preview: {
        time: { start: e.start, end: e.end, allDay: false },
        fields: ["Dental clinic, Ilica 5", "Me"],
        body: "Bring the X-ray from March",
      },
    });
  });

  it("never offers the Timeline/Week views - it has no feed card", () => {
    expect(calendarFeedCandidates([], now)).toEqual([]);
  });
});
