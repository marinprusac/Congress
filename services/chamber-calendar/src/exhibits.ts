import type { ExhibitSearchResult, ExhibitResolveResult } from "@congress/shared-types";
import { createPushExhibitSync, scoreExhibitMatch } from "@congress/chamber-kit";
import { env } from "./env.js";
import { toExhibitId, parseExhibitId, eventUrl, isLocalEventKey } from "./google/eventId.js";
import { searchCachedEvents, getCachedEvent, upsertCachedEventFromGoogle, type RawGoogleEvent } from "./google/cache.js";
import { googleCalendarFetch } from "./google/client.js";
import { getAccountRow } from "./google/accounts.js";
import { searchLocalEvents, getLocalEvent } from "./localEvents.js";
import { combineRankedEventSearch } from "./eventSearch.js";

// Deliberately talks directly to the low-level Google client/account
// lookups on a cache miss, and to localEvents.ts's own data-layer reads,
// rather than to google/events.ts's or calendar.ts's own getEvent - both of
// those already depend on this module (to push a sync on
// create/update/delete), and having this module call back into either
// would create a cycle.

export { toExhibitId, parseExhibitId, eventUrl };

export async function searchEventExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const trimmedQuery = query.trim();
  const events = combineRankedEventSearch(searchCachedEvents(query, limit), searchLocalEvents(query, limit), query, limit);
  return events.map((event) => ({
    id: toExhibitId(event.accountId, event.calendarId, event.id),
    type: "event",
    name: event.title,
    url: eventUrl(event.accountId, event.calendarId, event.id),
    ...(trimmedQuery
      ? {
          score: scoreExhibitMatch(trimmedQuery, [
            { text: event.title, isPrimary: true },
            { text: event.description ?? "", isPrimary: false },
            { text: event.location ?? "", isPrimary: false },
          ]),
        }
      : {}),
  }));
}

export async function resolveEventExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ExhibitResolveResult> => {
      const parsed = parseExhibitId(id);
      if (!parsed) return { id, deleted: true };

      if (isLocalEventKey(parsed.accountId, parsed.calendarId)) {
        const event = getLocalEvent(parsed.eventId);
        return event
          ? { id, name: event.title, url: eventUrl(parsed.accountId, parsed.calendarId, parsed.eventId) }
          : { id, deleted: true };
      }

      const cached = getCachedEvent(id);
      if (cached) return { id, name: cached.title, url: eventUrl(parsed.accountId, parsed.calendarId, parsed.eventId) };

      // Cache miss - outside the cache window, or not yet synced. Live-fetch
      // and opportunistically write it into the cache (read-through), same
      // tolerance google/events.ts's own getEvent applies for a direct lookup.
      const account = getAccountRow(parsed.accountId);
      if (!account) return { id, deleted: true };
      try {
        const raw = (await googleCalendarFetch(
          account,
          `/calendars/${encodeURIComponent(parsed.calendarId)}/events/${encodeURIComponent(parsed.eventId)}`
        )) as RawGoogleEvent;
        if (raw.status === "cancelled") return { id, deleted: true };
        const event = await upsertCachedEventFromGoogle(raw, parsed.accountId, parsed.calendarId);
        return { id, name: event.title, url: eventUrl(parsed.accountId, parsed.calendarId, parsed.eventId) };
      } catch {
        // Covers a real 404 and an account needing reconnect alike - the
        // per-chamber resolve contract only distinguishes resolved/deleted,
        // not degraded states (Capitol's own "unavailable" already covers
        // "the whole chamber is unreachable" one layer up).
        return { id, deleted: true };
      }
    })
  );
}

export const pushExhibitSync = createPushExhibitSync({
  chamber: "calendar",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
