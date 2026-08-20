// Exhibit-id codec for a Google Calendar event - split out as its own leaf
// module (no imports of its own) so both exhibits.ts and google/cache.ts can
// depend on it without either depending on the other.
const EVENT_ID_PREFIX = "event-";

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
