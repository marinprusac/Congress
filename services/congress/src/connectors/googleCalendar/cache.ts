import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { SourceRecord } from "../contract.js";
import { gcalDb as db } from "./db/client.js";
import { accounts, calendars, eventAttendees, events, settings } from "./db/schema.js";
import { eventFacts, rawFacts, timeMs, type RawGoogleEvent } from "./facts.js";
import { ownerZone, startOfDay } from "../../typeEngine/zone.js";

type EventRow = typeof events.$inferSelect;
type AttendeeRow = typeof eventAttendees.$inferSelect;

export function eventKey(accountId: number, calendarId: string, eventId: string): string {
  return `${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

export function parseEventKey(key: string): { accountId: number; calendarId: string; eventId: string } | null {
  const [a, c, e] = key.split(":");
  const accountId = Number(a);
  if (!Number.isInteger(accountId) || !c || !e) return null;
  return { accountId, calendarId: decodeURIComponent(c), eventId: decodeURIComponent(e) };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function toEventRow(raw: RawGoogleEvent, accountId: number, calendarId: string): typeof events.$inferInsert {
  const facts = rawFacts(raw);
  const allDay = Boolean(raw.start.date);
  return {
    key: eventKey(accountId, calendarId, raw.id),
    accountId,
    calendarId,
    eventId: raw.id,
    title: raw.summary ?? "",
    description: raw.description ?? "",
    location: raw.location ?? "",
    allDay,
    start: raw.start.date ?? raw.start.dateTime ?? "",
    end: raw.end.date ?? raw.end.dateTime ?? "",
    startMs: timeMs(raw.start),
    endMs: timeMs(raw.end),
    timeZone: raw.start.timeZone ?? null,
    htmlLink: raw.htmlLink ?? null,
    recurringEventId: raw.recurringEventId ?? null,
    organizerEmail: raw.organizer?.email ? normalizeEmail(raw.organizer.email) : null,
    organizerSelf: raw.organizer ? raw.organizer.self === true : true,
    guestsCanModify: raw.guestsCanModify === true,
    selfResponse: facts.selfResponse,
    googleUpdated: raw.updated ?? null,
    syncedAt: new Date(),
  };
}

// Upserts an event and its guest list, keeping people already resolved.
export function writeEvent(raw: RawGoogleEvent, accountId: number, calendarId: string): string {
  const row = toEventRow(raw, accountId, calendarId);
  const key = row.key;
  db.transaction((tx) => {
    tx.insert(events).values(row).onConflictDoUpdate({ target: events.key, set: row }).run();
    const previous = new Map(tx.select().from(eventAttendees).where(eq(eventAttendees.eventKey, key)).all().map((a) => [a.email, a]));
    tx.delete(eventAttendees).where(eq(eventAttendees.eventKey, key)).run();
    const seen = new Set<string>();
    for (const a of raw.attendees ?? []) {
      if (!a.email) continue;
      const email = normalizeEmail(a.email);
      if (seen.has(email)) continue;
      seen.add(email);
      const prev = previous.get(email);
      tx.insert(eventAttendees)
        .values({
          eventKey: key,
          email,
          displayName: a.displayName?.trim() || null,
          responseStatus: a.responseStatus ?? null,
          organizer: a.organizer === true,
          self: a.self === true,
          resource: a.resource === true,
          optional: a.optional === true,
          personId: prev?.personId ?? null,
        })
        .run();
    }
  });
  return key;
}

export function removeEvent(key: string): boolean {
  return db.transaction((tx) => {
    tx.delete(eventAttendees).where(eq(eventAttendees.eventKey, key)).run();
    return tx.delete(events).where(eq(events.key, key)).run().changes > 0;
  });
}

export function eventsOfCalendar(accountId: number, calendarId: string): EventRow[] {
  return db.select().from(events).where(and(eq(events.accountId, accountId), eq(events.calendarId, calendarId))).all();
}

export function getEventRow(key: string): EventRow | undefined {
  return db.select().from(events).where(eq(events.key, key)).get();
}

export function attendeesOf(key: string): AttendeeRow[] {
  return db.select().from(eventAttendees).where(eq(eventAttendees.eventKey, key)).all();
}

export function linkAttendee(key: string, email: string, personId: string): void {
  db.update(eventAttendees)
    .set({ personId })
    .where(and(eq(eventAttendees.eventKey, key), eq(eventAttendees.email, email)))
    .run();
}

// Guests not yet linked to a Person.
export function pendingAttendees() {
  return db
    .select({
      eventKey: eventAttendees.eventKey,
      email: eventAttendees.email,
      self: eventAttendees.self,
      resource: eventAttendees.resource,
      personId: eventAttendees.personId,
    })
    .from(eventAttendees)
    .where(and(isNull(eventAttendees.personId), eq(eventAttendees.self, false), eq(eventAttendees.resource, false)))
    .all();
}

// Both return the removed event keys, so the caller can emit their deletes.
export function purgeCalendar(accountId: number, calendarId: string): string[] {
  const keys = eventsOfCalendar(accountId, calendarId).map((e) => e.key);
  db.transaction((tx) => {
    if (keys.length > 0) tx.delete(eventAttendees).where(inArray(eventAttendees.eventKey, keys)).run();
    tx.delete(events).where(and(eq(events.accountId, accountId), eq(events.calendarId, calendarId))).run();
  });
  return keys;
}

export function forgetAccount(accountId: number): string[] {
  const keys = db.select({ key: events.key }).from(events).where(eq(events.accountId, accountId)).all().map((e) => e.key);
  db.transaction((tx) => {
    if (keys.length > 0) tx.delete(eventAttendees).where(inArray(eventAttendees.eventKey, keys)).run();
    tx.delete(events).where(eq(events.accountId, accountId)).run();
    tx.delete(calendars).where(eq(calendars.accountId, accountId)).run();
    tx.delete(accounts).where(eq(accounts.accountId, accountId)).run();
  });
  return keys;
}

// A Google time as an instant; an all-day date is midnight in the owner's zone
// (the end date stays exclusive, like Google's).
export function sourceTime(value: string, allDay: boolean, zone = ownerZone()): string | null {
  if (!value) return null;
  const ms = allDay ? startOfDay(value.slice(0, 10), zone) : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type CalendarMeta = { summary: string; color: string | null };

function calendarMeta(): Map<string, CalendarMeta> {
  return new Map(db.select().from(calendars).all().map((c) => [`${c.accountId}:${c.calendarId}`, { summary: c.summary, color: c.color }]));
}

export function toSourceRecord(row: EventRow, attendees: AttendeeRow[] = attendeesOf(row.key), cals: Map<string, CalendarMeta> = calendarMeta()): SourceRecord {
  const self = attendees.find((a) => a.self);
  const facts = eventFacts({
    organizerSelf: row.organizerSelf,
    hasOrganizer: true,
    guestsCanModify: row.guestsCanModify,
    selfResponse: row.selfResponse,
    hasSelfAttendee: self !== undefined,
  });
  const calendar = `${row.accountId}:${row.calendarId}`;
  const cal = cals.get(calendar);
  return {
    kind: "event",
    key: row.key,
    values: {
      title: row.title,
      description: row.description,
      location: row.location,
      allDay: row.allDay,
      start: sourceTime(row.start, row.allDay),
      end: sourceTime(row.end, row.allDay),
      htmlLink: row.htmlLink,
      calendar,
      calendarLabel: cal?.summary ?? row.calendarId,
      calendarColor: cal?.color ?? null,
      response: facts.selfResponse,
      attendees: attendees.filter((a) => !a.resource).map((a) => a.email),
      people: [...new Set(attendees.flatMap((a) => (a.personId ? [a.personId] : [])))],
    },
    facts: { editable: facts.editable, isInvitation: facts.isInvitation, canRsvp: facts.canRsvp, selfResponse: facts.selfResponse },
    updatedAt: row.googleUpdated,
  };
}

export function listEventRows(opts: { from?: string; to?: string } = {}): EventRow[] {
  const conds = [];
  if (opts.from) conds.push(gte(events.endMs, Date.parse(opts.from)));
  if (opts.to) conds.push(lt(events.startMs, Date.parse(opts.to)));
  return db
    .select()
    .from(events)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(events.startMs))
    .all();
}

export function cacheCounts(): { events: number; attendees: number; people: number } {
  const one = (q: string) => (db.get<{ n: number }>(sql.raw(q))?.n ?? 0);
  return {
    events: one("select count(*) n from events"),
    attendees: one("select count(*) n from event_attendees where self = 0 and resource = 0"),
    people: one("select count(distinct person_id) n from event_attendees where person_id is not null"),
  };
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.insert(settings).values({ key, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } }).run();
}
