// Mirrors services/chamber-calendar/src/exhibits.ts's toExhibitId - same
// format, duplicated client-side (backend and frontend already each keep
// their own small per-chamber exhibit helpers, e.g. Notes' wikilinks.ts).
export function toExhibitId(accountId: number, calendarId: string, eventId: string): string {
  return `event-${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}
