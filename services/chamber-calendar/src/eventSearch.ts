import type { CalendarEvent } from "./types.js";
import { scoreExhibitMatch } from "@congress/chamber-kit";

// Google (cached) events and local events are searched independently, each
// already ranked and truncated to `limit` by its own store (see
// google/cache.ts's searchCachedEvents / localEvents.ts's searchLocalEvents)
// - safe to merge the two lists and keep only the overall top `limit`,
// since neither store can omit an item that would outrank anything it kept
// (the same "top-K-of-N-sorted-streams" argument scoreExhibitMatch's other
// callers rely on, just applied across two sources instead of one). A plain
// re-sort-and-slice rather than a real streaming merge, since both lists are
// always tiny for a personal calendar. Shared by calendar.ts's own
// searchEvents and exhibits.ts's searchEventExhibits so the two don't
// duplicate this ranking logic.
export function combineRankedEventSearch(a: CalendarEvent[], b: CalendarEvent[], query: string, limit: number): CalendarEvent[] {
  const combined = [...a, ...b];
  const trimmed = query.trim();
  if (!trimmed) {
    return combined.sort((x, y) => new Date(x.start).getTime() - new Date(y.start).getTime()).slice(0, limit);
  }
  return combined
    .map((event) => ({
      event,
      score: scoreExhibitMatch(trimmed, [
        { text: event.title, isPrimary: true },
        { text: event.description ?? "", isPrimary: false },
        { text: event.location ?? "", isPrimary: false },
      ]),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ event }) => event);
}
