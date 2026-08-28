import type {
  CalendarEvent,
  AccountError,
  ListEventsResponse,
  CreateEventRequest,
  UpdateEventRequest,
} from "../types.js";
import { googleCalendarFetch, GoogleApiError } from "./client.js";
import { getAccountRow } from "./accounts.js";
import { listSelectedCalendarsInternal, calendarMeta } from "./calendars.js";
import { AccountNeedsReconnectError } from "./accounts.js";
import {
  isWithinCacheWindow,
  listCachedEvents,
  searchCachedEvents,
  getCachedEvent,
  upsertCachedEventFromGoogle,
  deleteCachedEvent,
} from "./cache.js";
import { toExhibitId, parseExhibitId } from "./eventId.js";
import { pushExhibitSync } from "../exhibits.js";
import { extractOutgoingExhibitRefs } from "@congress/chamber-kit";
import { listManualRefs, deleteManualRefsForEvent } from "../refs.js";
import { publishEvent } from "../events.js";
import { computeGoogleAttendance, resolveAttendance, setLocalNotAttending, deleteLocalAttendance } from "../attendance.js";

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleAttendee {
  email?: string;
  self?: boolean;
  responseStatus?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  organizer?: { self?: boolean };
  guestsCanModify?: boolean;
  attendees?: GoogleAttendee[];
}

export class EventNotEditableError extends Error {
  constructor(title: string) {
    super(`"${title}" can't be edited - it's managed by its organizer, not this account.`);
    this.name = "EventNotEditableError";
  }
}

// True unless this account is neither the organizer nor granted modify
// rights - the case for e.g. an auto-added Gmail reservation/reminder event
// (organizer is a Google service, guestsCanModify unset). Matches what a
// PATCH to this event would actually be allowed to do; not enforced by
// Google Calendar's own event resource as a single flag.
function isEventEditable(raw: GoogleEvent): boolean {
  const isOrganizer = raw.organizer ? raw.organizer.self === true : true;
  return isOrganizer || raw.guestsCanModify === true;
}

function normalizeGoogleEvent(
  raw: GoogleEvent,
  accountId: number,
  calendarId: string,
  calendarSummary: string,
  calendarColor: string | null
): CalendarEvent {
  const allDay = Boolean(raw.start.date);
  return {
    id: raw.id,
    accountId,
    calendarId,
    calendarSummary,
    calendarColor,
    title: raw.summary ?? "(untitled)",
    description: raw.description ?? null,
    location: raw.location ?? null,
    allDay,
    start: allDay ? raw.start.date! : raw.start.dateTime!,
    end: allDay ? raw.end.date! : raw.end.dateTime!,
    htmlLink: raw.htmlLink ?? null,
    editable: isEventEditable(raw),
    attendance: resolveAttendance(computeGoogleAttendance(raw), toExhibitId(accountId, calendarId, raw.id)),
  };
}

// <input type="datetime-local"> values look like "2026-08-15T02:03" - valid
// RFC3339 (what Google's API requires) needs seconds too, or Google 400s
// with an opaque "Bad Request".
function toRfc3339DateTime(value: string): string {
  return /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function toGoogleEventBody(input: {
  title?: string;
  description?: string;
  location?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  timeZone?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start !== undefined) {
    body.start = input.allDay
      ? { date: input.start }
      : { dateTime: toRfc3339DateTime(input.start), timeZone: input.timeZone };
  }
  if (input.end !== undefined) {
    body.end = input.allDay
      ? { date: input.end }
      : { dateTime: toRfc3339DateTime(input.end), timeZone: input.timeZone };
  }
  return body;
}

function requireAccount(accountId: number) {
  const account = getAccountRow(accountId);
  if (!account) throw new Error(`No such account: ${accountId}`);
  return account;
}

export async function listEvents(fromISO: string, toISO: string): Promise<ListEventsResponse> {
  if (isWithinCacheWindow(fromISO, toISO)) {
    return { events: listCachedEvents(fromISO, toISO), accountErrors: [] };
  }

  // A range outside the cache window (paging the agenda far enough back or
  // forward) falls back to a live fetch, same as before this cache existed -
  // the cache is a read-through optimization, never authoritative on its own.
  const selections = listSelectedCalendarsInternal();
  const byAccount = new Map<number, string[]>();
  for (const sel of selections) {
    const list = byAccount.get(sel.accountId) ?? [];
    list.push(sel.googleCalendarId);
    byAccount.set(sel.accountId, list);
  }

  const events: CalendarEvent[] = [];
  const accountErrors: AccountError[] = [];

  for (const [accountId, calendarIds] of byAccount) {
    const account = getAccountRow(accountId);
    if (!account) continue;
    try {
      for (const calendarId of calendarIds) {
        const params = new URLSearchParams({
          timeMin: fromISO,
          timeMax: toISO,
          singleEvents: "true",
          orderBy: "startTime",
        });
        const body = (await googleCalendarFetch(
          account,
          `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
        )) as { items?: GoogleEvent[] };
        const { summary, colorHex } = calendarMeta(accountId, calendarId);
        for (const raw of body.items ?? []) {
          // Same "not-attending events don't clutter the agenda" rule as
          // listCachedEvents - this is only the out-of-cache-window fallback
          // path, but it should still agree with the cached one.
          const event = normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
          if (!event.attendance.notAttending) events.push(event);
        }
      }
    } catch (err) {
      if (err instanceof AccountNeedsReconnectError) {
        accountErrors.push({ accountId: err.accountId, label: err.label, reason: "needs_reconnect" });
      } else {
        throw err;
      }
    }
  }

  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return { events, accountErrors };
}

// Delegates straight to the cache table - the cache window is sized (see
// google/cache.ts's CACHE_WINDOW_DAYS) to always fully cover this "rolling
// ~6-month window centered on now" search contract, so there's no live
// fallback branch here the way listEvents has for out-of-window ranges.
export async function searchEvents(query: string, limit = 20): Promise<ListEventsResponse> {
  return { events: searchCachedEvents(query, limit), accountErrors: [] };
}

export async function getEvent(accountId: number, calendarId: string, eventId: string): Promise<CalendarEvent> {
  const exhibitId = toExhibitId(accountId, calendarId, eventId);

  // Always try live first rather than only on a cache miss - a single-event
  // view is low-volume enough to afford the round-trip, and it's exactly the
  // moment staleness matters most: an RSVP answered directly in the Google
  // Calendar app (not through this Chamber's own Accept/Decline) only
  // reaches the cache on the next 5-minute poll otherwise, so this page
  // could keep showing a since-answered invitation as still pending.
  try {
    const account = requireAccount(accountId);
    const raw = (await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    )) as GoogleEvent;
    if (raw.status === "cancelled") {
      deleteCachedEvent(exhibitId);
      throw new GoogleApiError(404, "Event not found");
    }
    return upsertCachedEventFromGoogle(raw, accountId, calendarId);
  } catch (err) {
    // A confirmed 404/cancelled is real - propagate it rather than serving a
    // stale cached copy of an event that no longer exists. Anything else
    // (account needs reconnect, a transient Google error) falls back to
    // whatever's cached, the same tolerance the old cache-miss-only path had.
    if (err instanceof GoogleApiError && err.status === 404) throw err;
    const cached = getCachedEvent(exhibitId);
    if (cached) return cached;
    throw err;
  }
}

// The set of Exhibits this event points at is the union of what's embedded
// in its description ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Capitol as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncEventExhibit(result: CalendarEvent): Promise<void> {
  const exhibitId = toExhibitId(result.accountId, result.calendarId, result.id);
  const manual = listManualRefs(exhibitId) ?? [];
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(result.description ?? ""), ...manual]);
  await pushExhibitSync({
    id: exhibitId,
    type: "event",
    name: result.title,
    url: `/e/${result.accountId}/${encodeURIComponent(result.calendarId)}/${encodeURIComponent(result.id)}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs an event whose description didn't change but whose manual refs
// did (see the /api/exhibits/:id/refs routes in server.ts) - unlike the
// table-backed Chambers' resync helpers, this has to re-fetch from Google
// first since there's no local row to read the current name/description
// back from.
export async function resyncEventExhibit(exhibitId: string): Promise<void> {
  const parsed = parseExhibitId(exhibitId);
  if (!parsed || !getAccountRow(parsed.accountId)) return;
  try {
    const event = await getEvent(parsed.accountId, parsed.calendarId, parsed.eventId);
    await syncEventExhibit(event);
  } catch {
    // A transient Google error shouldn't fail the manual-ref add/remove
    // that triggered this resync.
  }
}

export async function createEvent(input: CreateEventRequest): Promise<CalendarEvent> {
  const account = requireAccount(input.accountId);
  const raw = (await googleCalendarFetch(account, `/calendars/${encodeURIComponent(input.calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(toGoogleEventBody(input)),
  })) as GoogleEvent;
  const result = upsertCachedEventFromGoogle(raw, input.accountId, input.calendarId);
  await syncEventExhibit(result);
  void publishEvent({
    type: "calendar.event_created",
    payload: {
      accountId: result.accountId,
      calendarId: result.calendarId,
      eventId: result.id,
      title: result.title,
      url: `/e/${result.accountId}/${encodeURIComponent(result.calendarId)}/${encodeURIComponent(result.id)}`,
      priority: "low",
    },
  });
  return result;
}

export async function updateEvent(
  accountId: number,
  calendarId: string,
  eventId: string,
  input: UpdateEventRequest
): Promise<CalendarEvent> {
  const account = requireAccount(accountId);
  let raw: GoogleEvent;
  try {
    raw = (await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(toGoogleEventBody(input)),
      }
    )) as GoogleEvent;
  } catch (err) {
    // Google itself is the source of truth for whether this PATCH was
    // allowed - a 403 here (not just a non-editable read we predicted
    // client-side) is what actually confirms it, so this is the one place
    // that turns it into a clear error rather than the generic 502
    // GoogleApiError mapping.
    if (err instanceof GoogleApiError && err.status === 403) {
      const current = await getEvent(accountId, calendarId, eventId);
      throw new EventNotEditableError(current.title);
    }
    throw err;
  }
  const result = upsertCachedEventFromGoogle(raw, accountId, calendarId);
  await syncEventExhibit(result);
  void publishEvent({
    type: "calendar.event_updated",
    payload: {
      accountId: result.accountId,
      calendarId: result.calendarId,
      eventId: result.id,
      title: result.title,
      url: `/e/${result.accountId}/${encodeURIComponent(result.calendarId)}/${encodeURIComponent(result.id)}`,
      priority: "low",
    },
  });
  return result;
}

// notAttending:true on an invitation (this account is a listed attendee who
// didn't organize the event) declines the real Google invite by patching
// this account's own attendee entry - visible to the organizer/other guests,
// exactly like clicking "No" in Google Calendar. On any other event (this
// account organizes it, or isn't a listed attendee at all - there's no
// Google RSVP to set), it's just a local, private note. false reverses
// either one. Re-fetches the raw event first (rather than trusting the
// cache) since patching attendees requires resending the *entire* list -
// Google replaces it wholesale, it doesn't merge a partial one - and the
// cache's own attendee data isn't kept around beyond the derived
// isInvitation/responseStatus fields.
export async function setEventAttendance(
  accountId: number,
  calendarId: string,
  eventId: string,
  notAttending: boolean
): Promise<CalendarEvent> {
  const account = requireAccount(accountId);
  const raw = (await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  )) as GoogleEvent;
  if (raw.status === "cancelled") throw new GoogleApiError(404, "Event not found");

  const { isInvitation } = computeGoogleAttendance(raw);
  let result: CalendarEvent;
  if (!isInvitation) {
    setLocalNotAttending(toExhibitId(accountId, calendarId, eventId), notAttending);
    result = upsertCachedEventFromGoogle(raw, accountId, calendarId);
  } else {
    const attendees = (raw.attendees ?? []).map((a) =>
      a.self ? { ...a, responseStatus: notAttending ? "declined" : "accepted" } : a
    );
    const updated = (await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: "PATCH", body: JSON.stringify({ attendees }) }
    )) as GoogleEvent;
    result = upsertCachedEventFromGoogle(updated, accountId, calendarId);
  }

  void publishEvent({
    type: "calendar.event_attendance_changed",
    payload: {
      accountId: result.accountId,
      calendarId: result.calendarId,
      eventId: result.id,
      title: result.title,
      notAttending,
      url: `/e/${result.accountId}/${encodeURIComponent(result.calendarId)}/${encodeURIComponent(result.id)}`,
      priority: "normal",
    },
  });
  return result;
}

export async function deleteEvent(accountId: number, calendarId: string, eventId: string): Promise<void> {
  const account = requireAccount(accountId);
  // Fetched first so the deletion sync push carries a real title - Google's
  // DELETE response has no body to read one back from.
  const existing = await getEvent(accountId, calendarId, eventId);
  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  const exhibitId = toExhibitId(accountId, calendarId, eventId);
  deleteCachedEvent(exhibitId);
  deleteManualRefsForEvent(exhibitId);
  deleteLocalAttendance(exhibitId);
  await pushExhibitSync({
    id: exhibitId,
    type: "event",
    name: existing.title,
    url: `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`,
    outgoingRefs: [],
    deleted: true,
  });
  void publishEvent({
    type: "calendar.event_deleted",
    payload: { accountId, calendarId, eventId, title: existing.title, priority: "low" },
  });
}
