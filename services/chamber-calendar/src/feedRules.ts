import { closeness, formatDuration } from "@congress/chamber-kit";
import type { FeedCandidate } from "@congress/shared-types";
import { toExhibitId } from "./google/eventId.js";
import type { CalendarEvent } from "./types.js";

const SOON_WINDOW_MS = 3 * 60 * 60 * 1000;

// How far around "now" the feed asks listEvents for - wide enough behind to
// catch an event already in progress, and ahead to cover the rest of today.
export const FEED_LOOKBEHIND_MS = 12 * 60 * 60 * 1000;
export const FEED_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// Calendar's home-feed candidates: an event in progress, or starting within
// a few hours (climbing as it nears), shows up on its own; an all-day event
// today sits lower; the Agenda view rises first thing in the morning.
// Events the owner isn't attending never
// show. Pure - `events` is listEvents()'s output around `now`, and `hour` is
// the local hour the morning bump keys off.
export function calendarFeedCandidates(events: CalendarEvent[], now: Date, hour = now.getHours()): FeedCandidate[] {
  const items: FeedCandidate[] = [];
  const nowMs = now.getTime();
  // All-day events carry plain "YYYY-MM-DD" dates (end exclusive), in the
  // server's local calendar day.
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  for (const event of events) {
    if (event.attendance.notAttending) continue;
    const exhibitId = toExhibitId(event.accountId, event.calendarId, event.id);

    if (event.allDay) {
      if (event.start.slice(0, 10) <= todayKey && todayKey < event.end.slice(0, 10)) {
        items.push({ kind: "exhibit", exhibitId, score: 40, reason: "Today" });
      }
      continue;
    }

    const startMs = new Date(event.start).getTime();
    const endMs = new Date(event.end).getTime();
    if (startMs <= nowMs && nowMs < endMs) {
      items.push({ kind: "exhibit", exhibitId, score: 85, reason: "Happening now" });
    } else if (startMs > nowMs && startMs - nowMs <= SOON_WINDOW_MS) {
      const ms = startMs - nowMs;
      items.push({ kind: "exhibit", exhibitId, score: Math.round(60 + 35 * closeness(ms, SOON_WINDOW_MS)), reason: `Starts in ${formatDuration(ms)}` });
    }
  }

  // The Agenda itself: first thing in the morning it's the day at a glance;
  // otherwise it sits low - the events that matter right now are already in
  // the feed on their own.
  if (hour >= 5 && hour < 11) {
    items.push({ kind: "view", viewId: "agenda", score: 50, reason: "Your day" });
  } else {
    items.push({ kind: "view", viewId: "agenda", score: 20 });
  }
  return items;
}
