import type {
  CalendarEvent,
  AccountError,
  ListEventsResponse,
  CreateEventRequest,
  UpdateEventRequest,
} from "@congress/shared-types";
import { googleAccounts, selectedCalendars } from "../db/schema.js";
import { db } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { googleCalendarFetch } from "./client.js";
import { getAccountRow } from "./accounts.js";
import { listSelectedCalendarsInternal } from "./calendars.js";
import { AccountNeedsReconnectError } from "./accounts.js";

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

export async function createEvent(input: CreateEventRequest): Promise<CalendarEvent> {
  const account = requireAccount(input.accountId);
  const raw = (await googleCalendarFetch(account, `/calendars/${encodeURIComponent(input.calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(toGoogleEventBody(input)),
  })) as GoogleEvent;
  const { summary, colorHex } = calendarMeta(input.accountId, input.calendarId);
  return normalizeGoogleEvent(raw, input.accountId, input.calendarId, summary, colorHex);
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
  return normalizeGoogleEvent(raw, accountId, calendarId, summary, colorHex);
}

export async function deleteEvent(accountId: number, calendarId: string, eventId: string): Promise<void> {
  const account = requireAccount(accountId);
  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
}
