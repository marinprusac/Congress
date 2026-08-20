import type { ExhibitSearchResult, ExhibitResolveResult } from "@congress/shared-types";
import { createPushExhibitSync } from "@congress/chamber-kit";
import { env } from "./env.js";
import { toExhibitId, parseExhibitId, eventUrl } from "./google/eventId.js";
import { searchCachedEvents, getCachedEvent, upsertCachedEventFromGoogle, type RawGoogleEvent } from "./google/cache.js";
import { googleCalendarFetch } from "./google/client.js";
import { getAccountRow } from "./google/accounts.js";

// Deliberately talks directly to the low-level Google client/account
// lookups on a cache miss, not to google/events.ts's own getEvent -
// events.ts already depends on this module (to push a sync on
// create/update/delete), and having this module call back into events.ts
// would create a cycle.

export { toExhibitId, parseExhibitId, eventUrl };

export async function searchEventExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  return searchCachedEvents(query, limit).map((event) => ({
    id: toExhibitId(event.accountId, event.calendarId, event.id),
    type: "event",
    name: event.title,
    url: eventUrl(event.accountId, event.calendarId, event.id),
  }));
}

export async function resolveEventExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ExhibitResolveResult> => {
      const parsed = parseExhibitId(id);
      if (!parsed) return { id, deleted: true };

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
        const event = upsertCachedEventFromGoogle(raw, parsed.accountId, parsed.calendarId);
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
