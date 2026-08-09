import type {
  CalendarEvent,
  AccountError,
  ListEventsResponse,
  CreateEventRequest,
  UpdateEventRequest,
  SharedExhibitContent,
  UpdateSharedExhibitContentRequest,
} from "@congress/shared-types";
import { googleAccounts, selectedCalendars } from "../db/schema.js";
import { db } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { googleCalendarFetch } from "./client.js";
import { getAccountRow } from "./accounts.js";
import { listSelectedCalendarsInternal } from "./calendars.js";
import { AccountNeedsReconnectError } from "./accounts.js";
import { toExhibitId, extractOutgoingExhibitRefs, pushExhibitSync, parseExhibitId } from "../exhibits.js";

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
  };
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
    body.start = input.allDay ? { date: input.start } : { dateTime: input.start, timeZone: input.timeZone };
  }
  if (input.end !== undefined) {
    body.end = input.allDay ? { date: input.end } : { dateTime: input.end, timeZone: input.timeZone };
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

export async function getEvent(accountId: number, calendarId: string, eventId: string): Promise<CalendarEvent> {
  const account = requireAccount(accountId);
  const raw = (await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  )) as GoogleEvent;
  const { summary, colorHex } = calendarMeta(accountId, calendarId);
  return normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
}

async function syncEventExhibit(result: CalendarEvent): Promise<void> {
  await pushExhibitSync({
    id: toExhibitId(result.accountId, result.calendarId, result.id),
    type: "event",
    name: result.title,
    url: `/e/${result.accountId}/${encodeURIComponent(result.calendarId)}/${encodeURIComponent(result.id)}`,
    outgoingRefs: extractOutgoingExhibitRefs(result.description ?? ""),
  });
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
  const raw = (await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(toGoogleEventBody(input)),
    }
  )) as GoogleEvent;
  const { summary, colorHex } = calendarMeta(accountId, calendarId);
  const result = normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
  await syncEventExhibit(result);
  return result;
}

function formatEventBody(event: CalendarEvent): string {
  const lines = [`${event.start} – ${event.end}`];
  if (event.location) lines.push(`Location: ${event.location}`);
  if (event.description) lines.push("", event.description);
  return lines.join("\n");
}

function toExhibitContent(id: string, event: CalendarEvent): SharedExhibitContent {
  return { id, chamber: "calendar", type: "event", name: event.title, body: formatEventBody(event), isBinary: false };
}

export async function getEventExhibitContent(id: string): Promise<SharedExhibitContent | null> {
  const parsed = parseExhibitId(id);
  if (!parsed || !getAccountRow(parsed.accountId)) return null;
  try {
    const event = await getEvent(parsed.accountId, parsed.calendarId, parsed.eventId);
    return toExhibitContent(id, event);
  } catch {
    return null;
  }
}

// The generic envelope's "body" only ever round-trips through an event's
// description - reschedules (start/end/location) aren't editable via a
// share, deliberately narrower than the full owner-only update endpoint.
export async function updateEventExhibitContent(
  id: string,
  input: UpdateSharedExhibitContentRequest
): Promise<SharedExhibitContent | null> {
  const parsed = parseExhibitId(id);
  if (!parsed || !getAccountRow(parsed.accountId)) return null;
  try {
    const event = await updateEvent(parsed.accountId, parsed.calendarId, parsed.eventId, {
      title: input.title,
      description: input.body,
    });
    return toExhibitContent(id, event);
  } catch {
    return null;
  }
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
  await pushExhibitSync({
    id: toExhibitId(accountId, calendarId, eventId),
    type: "event",
    name: existing.title,
    url: `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`,
    outgoingRefs: [],
    deleted: true,
  });
}
