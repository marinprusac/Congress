import type {
  GoogleAccount,
  GoogleCalendarListItem,
  SelectedCalendar,
  SetCalendarSelectionRequest,
  CalendarEvent,
  ListEventsResponse,
  CreateEventRequest,
  UpdateEventRequest,
} from "@congress/shared-types";

// In production this Chamber's frontend is proxied through Capitol at
// "/calendar/*", but its API calls still need to reach Capitol's gateway at
// "/api/calendar/*" (Capitol forwards "/api/calendar/<rest>" to this
// Chamber's own "/api/<rest>"). In dev, Vite proxies "/api" straight to this
// Chamber's own server, so no "/calendar" segment is needed there.
const API_BASE = import.meta.env.PROD ? "/api/calendar" : "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchAccounts(): Promise<GoogleAccount[]> {
  return fetch(`${API_BASE}/accounts`).then((res) => json(res));
}

export function updateAccountLabel(id: number, label: string): Promise<GoogleAccount> {
  return fetch(`${API_BASE}/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  }).then((res) => json(res));
}

export async function disconnectAccount(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/accounts/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to disconnect account: ${res.status}`);
  }
}

export function connectAccountUrl(): string {
  return `${API_BASE}/oauth/google/start`;
}

export function fetchAvailableCalendars(accountId: number): Promise<GoogleCalendarListItem[]> {
  return fetch(`${API_BASE}/calendars/available?accountId=${accountId}`).then((res) => json(res));
}

export function fetchSelectedCalendars(): Promise<SelectedCalendar[]> {
  return fetch(`${API_BASE}/calendars/selected`).then((res) => json(res));
}

export function setCalendarSelection(
  accountId: number,
  googleCalendarId: string,
  input: SetCalendarSelectionRequest
): Promise<void> {
  return fetch(
    `${API_BASE}/calendars/${accountId}/${encodeURIComponent(googleCalendarId)}/selection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  ).then((res) => json(res));
}

export function fetchEvents(fromISO: string, toISO: string): Promise<ListEventsResponse> {
  const params = new URLSearchParams({ from: fromISO, to: toISO });
  return fetch(`${API_BASE}/events?${params.toString()}`).then((res) => json(res));
}

export function fetchEvent(accountId: number, calendarId: string, eventId: string): Promise<CalendarEvent> {
  return fetch(
    `${API_BASE}/events/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`
  ).then((res) => json(res));
}

export function createEvent(input: CreateEventRequest): Promise<CalendarEvent> {
  return fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateEvent(
  accountId: number,
  calendarId: string,
  eventId: string,
  input: UpdateEventRequest
): Promise<CalendarEvent> {
  return fetch(
    `${API_BASE}/events/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  ).then((res) => json(res));
}

export async function deleteEvent(accountId: number, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/events/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete event: ${res.status}`);
  }
}
