import { closeness, formatDuration, plainTextPreview } from "@congress/chamber-kit";
import type { FeedCandidate, FeedPreview } from "@congress/shared-types";
import { toExhibitId } from "./google/eventId.js";
import type { CalendarEvent } from "./types.js";

// What the feed shows inline for an event: when, where, which calendar,
// and the description.
function preview(event: CalendarEvent): FeedPreview {
  const fields = [event.location?.trim(), event.calendarSummary].filter((f): f is string => Boolean(f)).map((f) => f.slice(0, 80));
  return {
    time: { start: event.start, end: event.end, allDay: event.allDay },
    fields: fields.length > 0 ? fields : undefined,
    body: plainTextPreview(event.description),
  };
}

const SOON_WINDOW_MS = 3 * 60 * 60 * 1000;

// How far around "now" the feed asks listEvents for - wide enough behind to
// catch an event already in progress, and ahead to cover the rest of today.
export const FEED_LOOKBEHIND_MS = 12 * 60 * 60 * 1000;
export const FEED_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// Calendar's home-feed candidates: an event in progress, or starting within
// a few hours (climbing as it nears), shows up on its own; an all-day event
// today sits lower. Each carries its time, place and description inline.
// Events the owner isn't attending never show. The Timeline and Week views have
// no feed card, so they aren't feed candidates - they're reached through
// Search and the pinned row. Pure - `events` is listEvents()'s output around `now`.
export function calendarFeedCandidates(events: CalendarEvent[], now: Date): FeedCandidate[] {
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
        items.push({ kind: "exhibit", exhibitId, score: 40, reason: "Today", preview: preview(event) });
      }
      continue;
    }

    const startMs = new Date(event.start).getTime();
    const endMs = new Date(event.end).getTime();
    if (startMs <= nowMs && nowMs < endMs) {
      items.push({ kind: "exhibit", exhibitId, score: 85, reason: "Happening now", preview: preview(event) });
    } else if (startMs > nowMs && startMs - nowMs <= SOON_WINDOW_MS) {
      const ms = startMs - nowMs;
      items.push({
        kind: "exhibit",
        exhibitId,
        score: Math.round(60 + 35 * closeness(ms, SOON_WINDOW_MS)),
        reason: `Starts in ${formatDuration(ms)}`,
        preview: preview(event),
      });
    }
  }

  return items;
}
