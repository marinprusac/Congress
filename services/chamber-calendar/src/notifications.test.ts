import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "./types.js";

vi.mock("./google/cache.js", () => ({
  listCachedEvents: vi.fn(),
}));

import { listCachedEvents } from "./google/cache.js";
import { startUpcomingEventNotifications, stopUpcomingEventNotifications } from "./notifications.js";

function fakeEvent(startMs: number, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    accountId: 1,
    calendarId: "primary",
    calendarSummary: "Primary",
    calendarColor: null,
    title: "Standup",
    description: null,
    location: null,
    descriptionRich: null,
    locationRich: null,
    allDay: false,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 30 * 60 * 1000).toISOString(),
    htmlLink: null,
    editable: true,
    attendance: { isInvitation: false, responseStatus: null, notAttending: false },
    ...overrides,
  };
}

describe("upcoming event notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    vi.mocked(listCachedEvents).mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    );
  });

  afterEach(() => {
    stopUpcomingEventNotifications();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // The reported bug: an event already inside the 30-minute lookahead window
  // (or one a poll only discovers late) fires its "starting soon" event
  // immediately, but then re-fires on every subsequent 5-minute poll for as
  // long as the same event keeps matching the query - including well after
  // its own start time has passed - because the old code deleted its
  // `scheduled` entry the instant it fired, so the next poll saw no record
  // of it ever having happened and treated it as brand new again.
  it("fires a starting-soon event at most once, even though later polls keep returning the same event", () => {
    const startMs = Date.now() + 25 * 60 * 1000; // already within the 30-min lookahead
    vi.mocked(listCachedEvents).mockReturnValue([fakeEvent(startMs)]);

    // startUpcomingEventNotifications' first poll runs synchronously and
    // finds the event already overdue for its own fire instant (delay 0);
    // advancing past that tick is enough to flush it.
    startUpcomingEventNotifications();
    vi.advanceTimersByTime(0);

    expect(fetch).toHaveBeenCalledTimes(1);

    // Three more 5-minute polls tick by; listCachedEvents keeps returning
    // the same event (its start hasn't actually passed yet).
    vi.advanceTimersByTime(3 * 5 * 60 * 1000);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fires again if the event's start time is rescheduled after it already fired", () => {
    const startMs = Date.now() + 25 * 60 * 1000;
    vi.mocked(listCachedEvents).mockReturnValue([fakeEvent(startMs)]);

    startUpcomingEventNotifications();
    vi.advanceTimersByTime(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Pushed back by 20 minutes - its own fire instant (start - 30min) is
    // now 10 minutes past the poll that discovers the change.
    const rescheduledStartMs = startMs + 20 * 60 * 1000;
    vi.mocked(listCachedEvents).mockReturnValue([fakeEvent(rescheduledStartMs)]);

    vi.advanceTimersByTime(5 * 60 * 1000); // the next poll tick, sees the new start time
    expect(fetch).toHaveBeenCalledTimes(1); // not due yet - still 10 minutes out

    vi.advanceTimersByTime(10 * 60 * 1000); // reaches the rescheduled fire instant
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not fire before an event's own precise instant, for an event discovered ahead of its lookahead threshold", () => {
    // Starts in 35 minutes - inside a real query's 30-min lookahead it
    // wouldn't even be returned yet, but this exercises scheduleFire
    // directly (listCachedEvents is mocked) to confirm it still waits for
    // the real threshold (start - 30min = 5 minutes from now) rather than
    // firing the moment it's seen.
    const startMs = Date.now() + 35 * 60 * 1000;
    vi.mocked(listCachedEvents).mockReturnValue([fakeEvent(startMs)]);

    // pollUpcomingEvents runs synchronously inside start - only a 5-minute
    // setTimeout should be armed at this point, nothing fired yet.
    startUpcomingEventNotifications();
    expect(fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops re-arming once an event drops out of the polled window", () => {
    const startMs = Date.now() + 25 * 60 * 1000;
    vi.mocked(listCachedEvents).mockReturnValue([fakeEvent(startMs)]);

    startUpcomingEventNotifications();
    vi.advanceTimersByTime(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    // The event's start has now passed - a real listCachedEvents call would
    // no longer return it.
    vi.mocked(listCachedEvents).mockReturnValue([]);
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
