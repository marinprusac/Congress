import { describe, expect, it } from "vitest";
import { combineRankedEventSearch } from "./eventSearch.js";
import type { CalendarEvent } from "./types.js";

function fakeEvent(id: string, title: string, startIso: string, description: string | null = null): CalendarEvent {
  return {
    id,
    accountId: 1,
    calendarId: "primary",
    calendarSummary: "Primary",
    calendarColor: null,
    title,
    description,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    start: startIso,
    end: startIso,
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
  };
}

describe("combineRankedEventSearch", () => {
  it("ranks a title match from one source above a description-only match from the other", () => {
    const google = [fakeEvent("g-1", "Unrelated errand", "2026-03-01T10:00:00Z", "Discuss the ESN rollout")];
    const local = [fakeEvent("l-1", "ESN", "2026-03-05T10:00:00Z")];

    const combined = combineRankedEventSearch(google, local, "ESN", 10);
    expect(combined.map((e) => e.id)).toEqual(["l-1", "g-1"]);
  });

  it("truncates the merged result to the requested limit", () => {
    const google = [fakeEvent("g-1", "Match A", "2026-03-01T10:00:00Z")];
    const local = [fakeEvent("l-1", "Match B", "2026-03-02T10:00:00Z")];

    expect(combineRankedEventSearch(google, local, "Match", 1)).toHaveLength(1);
  });

  it("falls back to chronological order across both sources for an empty query", () => {
    const google = [fakeEvent("g-1", "Later", "2026-03-05T10:00:00Z")];
    const local = [fakeEvent("l-1", "Earlier", "2026-03-01T10:00:00Z")];

    const combined = combineRankedEventSearch(google, local, "", 10);
    expect(combined.map((e) => e.id)).toEqual(["l-1", "g-1"]);
  });
});
