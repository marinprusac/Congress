// Exhibit-id codec for a calendar event - split out as its own leaf module
// (no imports of its own) so exhibits.ts, google/cache.ts, localEvents.ts
// and calendar.ts can all depend on it without any of them depending on
// each other. Despite living under google/, this now also codes for a
// locally-stored event (see db/schema.ts's localEvents table) - it's
// addressed under the same (accountId, calendarId, eventId) triple a Google
// event is, just under the reserved pseudo-identity below, so every route,
// exhibit id, and frontend helper built around that triple keeps working
// unchanged for a local event too.
const EVENT_ID_PREFIX = "event-";

// No real Google account is ever assigned id 0 (googleAccounts.id
// auto-increments from 1), and no real Google calendar id is ever the bare
// string "local" - so this pair is safe to reserve as the pseudo
// account/calendar identity every locally-stored event is addressed under.
export const LOCAL_ACCOUNT_ID = 0;
export const LOCAL_CALENDAR_ID = "local";

export function isLocalEventKey(accountId: number, calendarId: string): boolean {
  return accountId === LOCAL_ACCOUNT_ID && calendarId === LOCAL_CALENDAR_ID;
}

// <input type="datetime-local"> values look like "2026-08-15T02:03" - valid
// RFC3339 (what Google's API requires) needs seconds too, or Google 400s
// with an opaque "Bad Request". Kept here rather than in google/events.ts
// (the only place that actually talks RFC3339 to Google) so localEvents.ts
// can reuse the same "always carries seconds" normalization for its own
// start/end without importing google/events.ts - that module already
// depends on exhibits.ts, which needs to depend on localEvents.ts (to
// search/resolve local events as Exhibits), so a localEvents.ts ->
// google/events.ts import would complete a cycle back through here. A local
// event's own start/end never gets an offset/timeZone appended the way
// google/events.ts's toGoogleEventBody does for Google - stored exactly as
// typed, deliberately offset-less (see localEvents.ts's header comment).
export function toRfc3339DateTime(value: string): string {
  return /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

export function toExhibitId(accountId: number, calendarId: string, eventId: string): string {
  return `${EVENT_ID_PREFIX}${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

export function parseExhibitId(id: string): { accountId: number; calendarId: string; eventId: string } | null {
  if (!id.startsWith(EVENT_ID_PREFIX)) return null;
  const parts = id.slice(EVENT_ID_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [accountIdStr, encCalendarId, encEventId] = parts;
  const accountId = Number(accountIdStr);
  if (!Number.isInteger(accountId)) return null;
  return { accountId, calendarId: decodeURIComponent(encCalendarId!), eventId: decodeURIComponent(encEventId!) };
}

export function eventUrl(accountId: number, calendarId: string, eventId: string): string {
  return `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
}
