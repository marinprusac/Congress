import { ConnectorRefusedError, type ConnectorContext, type SourceRecord, type SourceValue } from "../contract.js";
import { API, listCalendars } from "./calendars.js";
import { getEventRow, parseEventKey, removeEvent, toSourceRecord, writeEvent } from "./cache.js";
import { RESPONSES, rawFacts, type RawGoogleEvent } from "./facts.js";

// Writes to Google, then through to the cache. Unused until phase 6 bindings.

const str = (v: SourceValue | undefined) => (typeof v === "string" ? v : undefined);

function eventUrl(calendarId: string, eventId?: string): string {
  const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

// Maps source values to Google's body; only the keys present are sent.
export function toGoogleBody(values: Record<string, SourceValue>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ("title" in values) body.summary = str(values.title) ?? "";
  if ("description" in values) body.description = str(values.description) ?? "";
  if ("location" in values) body.location = str(values.location) ?? "";
  const timeZone = str(values.timeZone);
  const time = (v: SourceValue | undefined) => {
    const s = str(v);
    if (!s) throw new ConnectorRefusedError("start and end are required");
    return values.allDay === true ? { date: s.slice(0, 10), dateTime: null } : { dateTime: s, date: null, ...(timeZone ? { timeZone } : {}) };
  };
  if ("start" in values) body.start = time(values.start);
  if ("end" in values) body.end = time(values.end);
  return body;
}

function editableRow(key: string) {
  const row = getEventRow(key);
  if (!row) throw new ConnectorRefusedError("event isn't in the cache");
  return row;
}

function commit(ctx: ConnectorContext, raw: RawGoogleEvent, accountId: number, calendarId: string): SourceRecord {
  const key = writeEvent(raw, accountId, calendarId);
  ctx.emitChange("event", key);
  return toSourceRecord(getEventRow(key)!);
}

export async function createEvent(ctx: ConnectorContext, values: Record<string, SourceValue>): Promise<SourceRecord> {
  const [acct, ...rest] = (str(values.calendar) ?? "").split(":");
  const accountId = Number(acct);
  const calendarId = rest.join(":");
  if (!listCalendars(accountId).some((c) => c.calendarId === calendarId && c.selected)) {
    throw new ConnectorRefusedError("that calendar isn't synced");
  }
  const raw = (await ctx.google.fetch(accountId, `${eventUrl(calendarId)}?sendUpdates=none`, {
    method: "POST",
    body: JSON.stringify(toGoogleBody(values)),
  })) as RawGoogleEvent;
  return commit(ctx, raw, accountId, calendarId);
}

export async function updateEvent(ctx: ConnectorContext, key: string, patch: Record<string, SourceValue>): Promise<SourceRecord> {
  const row = editableRow(key);
  if (!toSourceRecord(row).facts.editable) throw new ConnectorRefusedError("this event can't be edited here");
  const merged = "allDay" in patch || !("start" in patch || "end" in patch) ? patch : { ...patch, allDay: row.allDay };
  const raw = (await ctx.google.fetch(row.accountId, `${eventUrl(row.calendarId, row.eventId)}?sendUpdates=none`, {
    method: "PATCH",
    body: JSON.stringify(toGoogleBody(merged)),
  })) as RawGoogleEvent;
  return commit(ctx, raw, row.accountId, row.calendarId);
}

export async function deleteEvent(ctx: ConnectorContext, key: string): Promise<void> {
  const row = editableRow(key);
  if (!toSourceRecord(row).facts.editable) throw new ConnectorRefusedError("this event can't be deleted here");
  await ctx.google.fetch(row.accountId, `${eventUrl(row.calendarId, row.eventId)}?sendUpdates=none`, { method: "DELETE" });
  removeEvent(key);
  ctx.emitChange("event", key, true);
}

// Answers an invitation; Google tells the organizer.
export async function rsvp(ctx: ConnectorContext, key: string, response: SourceValue | undefined): Promise<SourceRecord> {
  if (typeof response !== "string" || !(RESPONSES as readonly string[]).includes(response) || response === "needsAction") {
    throw new ConnectorRefusedError("response must be accepted, tentative or declined");
  }
  const parsed = parseEventKey(key);
  if (!parsed) throw new ConnectorRefusedError("bad event key");
  const url = eventUrl(parsed.calendarId, parsed.eventId);
  const live = (await ctx.google.fetch(parsed.accountId, url)) as RawGoogleEvent;
  if (!rawFacts(live).canRsvp) throw new ConnectorRefusedError("this event isn't an invitation");
  const attendees = (live.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: response } : a));
  const raw = (await ctx.google.fetch(parsed.accountId, `${url}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify({ attendees }),
  })) as RawGoogleEvent;
  return commit(ctx, raw, parsed.accountId, parsed.calendarId);
}
