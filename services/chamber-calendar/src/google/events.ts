import type {
  CalendarEvent,
  AccountError,
  ListEventsResponse,
  CreateEventRequest,
  UpdateEventRequest,
} from "../types.js";
import { googleAccounts, selectedCalendars } from "../db/schema.js";
import { db } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { googleCalendarFetch, GoogleApiError } from "./client.js";
import { getAccountRow } from "./accounts.js";
import { listSelectedCalendarsInternal } from "./calendars.js";
import { AccountNeedsReconnectError } from "./accounts.js";
import { toExhibitId, pushExhibitSync, parseExhibitId } from "../exhibits.js";
import { extractOutgoingExhibitRefs } from "@congress/chamber-kit";
import { listManualRefs, deleteManualRefsForEvent } from "../refs.js";

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  organizer?: { self?: boolean };
  guestsCanModify?: boolean;
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

function calendarMeta(accountId: number, googleCalendarId: string): { summary: string; colorHex: string | null } {
  const row = db
    .select({ summary: selectedCalendars.summary, colorHex: selectedCalendars.colorHex })
    .from(selectedCalendars)
    .where(
      and(eq(selectedCalendars.accountId, accountId), eq(selectedCalendars.googleCalendarId, googleCalendarId))
    )
    .get();
  return row ?? { summary: googleCalendarId, colorHex: null };
}

export async function listEvents(fromISO: string, toISO: string): Promise<ListEventsResponse> {
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
          events.push(normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex));
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

  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, accountErrors };
}

// A non-empty query also looks slightly into the past (someone referencing
// a recent meeting), an empty query only looks forward - same window/intent
// split as exhibits.ts's searchEventExhibits, which this duplicates the
// window size from rather than importing (that module deliberately avoids
// depending back on this one to dodge a cycle).
const SEARCH_WINDOW_DAYS = 180;

export async function searchEvents(query: string, limit = 20): Promise<ListEventsResponse> {
  const trimmed = query.trim();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const timeMin = new Date(trimmed ? now - SEARCH_WINDOW_DAYS * dayMs : now).toISOString();
  const timeMax = new Date(now + SEARCH_WINDOW_DAYS * dayMs).toISOString();

  const events: CalendarEvent[] = [];
  const accountErrors: AccountError[] = [];

  for (const sel of listSelectedCalendarsInternal()) {
    if (events.length >= limit) break;
    const account = getAccountRow(sel.accountId);
    if (!account) continue;
    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(limit),
      });
      if (trimmed) params.set("q", trimmed);
      const body = (await googleCalendarFetch(
        account,
        `/calendars/${encodeURIComponent(sel.googleCalendarId)}/events?${params.toString()}`
      )) as { items?: GoogleEvent[] };
      const { summary, colorHex } = calendarMeta(sel.accountId, sel.googleCalendarId);
      for (const raw of body.items ?? []) {
        events.push(normalizeGoogleEvent(raw, sel.accountId, sel.googleCalendarId, summary, colorHex));
      }
    } catch (err) {
      if (err instanceof AccountNeedsReconnectError) {
        accountErrors.push({ accountId: err.accountId, label: err.label, reason: "needs_reconnect" });
      }
      // Otherwise: same per-account isolation as searchEventExhibits - one
      // unreachable calendar/account shouldn't fail the whole search.
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events: events.slice(0, limit), accountErrors };
}

export async function getEvent(accountId: number, calendarId: string, eventId: string): Promise<CalendarEvent> {
  const account = requireAccount(accountId);
  const raw = (await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  )) as GoogleEvent;
  const { summary, colorHex } = calendarMeta(accountId, calendarId);
  return normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
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
  const { summary, colorHex } = calendarMeta(input.accountId, input.calendarId);
  const result = normalizeGoogleEvent(raw, input.accountId, input.calendarId, summary, colorHex);
  await syncEventExhibit(result);
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
  const { summary, colorHex } = calendarMeta(accountId, calendarId);
  const result = normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
  await syncEventExhibit(result);
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
  deleteManualRefsForEvent(exhibitId);
  await pushExhibitSync({
    id: exhibitId,
    type: "event",
    name: existing.title,
    url: `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`,
    outgoingRefs: [],
    deleted: true,
  });
}
