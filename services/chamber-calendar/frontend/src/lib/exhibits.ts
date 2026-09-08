// Mirrors services/chamber-calendar/src/exhibits.ts's toExhibitId - same
// format, duplicated client-side (backend and frontend already each keep
// their own small per-chamber exhibit helpers, e.g. Notes' wikilinks.ts).
export function toExhibitId(accountId: number, calendarId: string, eventId: string): string {
  return `event-${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

// Mirrors the backend's own LOCAL_ACCOUNT_ID (services/chamber-calendar/src/
// google/eventId.ts) - the pseudo account id every locally-stored event
// (never synced to Google) is addressed under.
export const LOCAL_ACCOUNT_ID = 0;

export function isLocalEvent(event: { accountId: number }): boolean {
  return event.accountId === LOCAL_ACCOUNT_ID;
}
