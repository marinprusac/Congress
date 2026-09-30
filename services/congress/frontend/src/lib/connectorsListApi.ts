// Connectors (connectors/registry.ts) and the Google Calendar panel's API.

const BASE = "/congress/connectors";

export interface ConnectorStatus {
  name: string;
  label: string;
  state: "active" | "offline";
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  nextSyncAt: string | null;
}

export interface CalendarPanelStatus {
  accounts: {
    id: number;
    label: string;
    lastSyncedAt: string | null;
    lastError: string | null;
    calendars: { id: string; summary: string; color: string | null; primary: boolean; selected: boolean }[];
  }[];
  counts: { events: number; attendees: number; people: number };
  settings: CalendarSettings;
}

export interface CalendarSettings {
  intervalMinutes: number;
  people: boolean;
  peopleAvailable: boolean;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const fetchConnectors = () => send<ConnectorStatus[]>("");
export const syncConnector = (name: string) => send<ConnectorStatus>(`/${name}/sync`, { method: "POST" });

const GCAL = "/google-calendar";
export const fetchCalendarPanel = () => send<CalendarPanelStatus>(`${GCAL}/status`);
export const refreshCalendarList = (accountId: number) => send<{ ok: true }>(`${GCAL}/accounts/${accountId}/calendars/refresh`, { method: "POST" });
export const selectCalendar = (accountId: number, calendarId: string, selected: boolean) =>
  send<{ ok: true }>(`${GCAL}/accounts/${accountId}/calendars/${encodeURIComponent(calendarId)}`, { method: "PUT", body: JSON.stringify({ selected }) });
export const saveCalendarSettings = (patch: Partial<Pick<CalendarSettings, "intervalMinutes" | "people">>) =>
  send<CalendarSettings>(`${GCAL}/settings`, { method: "PUT", body: JSON.stringify(patch) });
