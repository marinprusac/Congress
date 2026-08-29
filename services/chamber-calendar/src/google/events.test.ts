import { describe, expect, it, vi } from "vitest";

vi.mock("../exhibits.js", () => ({ pushExhibitSync: vi.fn() }));
vi.mock("../refs.js", () => ({ listManualRefs: vi.fn(() => []), deleteManualRefsForEvent: vi.fn() }));

import { pushExhibitSync } from "../exhibits.js";
import { syncEventExhibit } from "./events.js";
import type { CalendarEvent } from "../types.js";

function fakeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    accountId: 1,
    calendarId: "primary",
    calendarSummary: "Primary",
    calendarColor: null,
    title: "Coffee",
    description: null,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    start: "2026-01-01T10:00:00Z",
    end: "2026-01-01T10:30:00Z",
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    ...overrides,
  };
}

// Regression test for the description-leak fix: description/location are
// now always the *plain*, already-projected text sent to Google (see
// richTextMirror.ts) and never contain raw "[[exhibit:...]]" syntax
// themselves - so the Exhibit graph has to be built from the rich fields
// instead, exactly the source that still carries tokens.
describe("syncEventExhibit", () => {
  it("sources outgoing refs from descriptionRich/locationRich, not the plain description/location", async () => {
    const event = fakeEvent({
      description: "Meet at Cafe Roma",
      descriptionRich: "Meet at [[exhibit:map:place-4|Cafe Roma]]",
      location: "Cafe Roma",
      locationRich: "[[exhibit:map:place-4|Cafe Roma]]",
    });

    await syncEventExhibit(event);

    expect(pushExhibitSync).toHaveBeenCalledWith(expect.objectContaining({ outgoingRefs: ["place-4"] }));
  });

  it("produces no refs when the rich fields hold no tokens, even if the plain text mentions one by coincidence", async () => {
    const event = fakeEvent({ description: "exhibit:map:place-4 is not a real token here", descriptionRich: null });

    await syncEventExhibit(event);

    expect(pushExhibitSync).toHaveBeenCalledWith(expect.objectContaining({ outgoingRefs: [] }));
  });
});
