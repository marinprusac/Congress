import { eq, like, or } from "drizzle-orm";
import type { CalendarEvent } from "./types.js";
import { db } from "./db/client.js";
import { localEvents } from "./db/schema.js";
import { LOCAL_ACCOUNT_ID, LOCAL_CALENDAR_ID, toExhibitId, toRfc3339DateTime } from "./google/eventId.js";
import { projectRichToPlain } from "./google/richTextMirror.js";
import { buildLabelResolver } from "./google/cache.js";
import { resolveAttendance } from "./attendance.js";
import { extractExhibitTokensWithLabels, scoreExhibitMatch } from "@congress/chamber-kit";

// The data layer for an event that lives only in this Chamber's own SQLite
// file - never sent to Google at all. Mirrors google/cache.ts's role for a
// Google-backed event (row <-> CalendarEvent, list/search/get), deliberately
// kept as its own leaf module (no dependency on google/events.ts, which
// itself depends on exhibits.ts) so that exhibits.ts can import this module
// directly to search/resolve local events without creating an import cycle
// - exactly the same reason exhibits.ts already talks to google/cache.ts
// directly instead of going through google/events.ts. calendar.ts is the
// one place *above* both this module and google/events.ts that wires a
// write here up to an exhibit sync/event publish, the same way
// google/events.ts itself does for a Google write.
//
// Unlike cachedEvents, there's no external system to reconcile against - no
// poll-sync, no offset-suffixed Google timestamps. A local event's
// start/end are stored exactly as the browser sent them (no timezone
// offset appended) - `new Date(stored)` is treated as local time by every
// reader, which is correct and stable as long as this Chamber has exactly
// one user viewing it in one timezone at a time, which is this whole
// system's own standing assumption (see CLAUDE.md).

type LocalEventRow = typeof localEvents.$inferSelect;

function rowToCalendarEvent(row: LocalEventRow): CalendarEvent {
  const exhibitId = toExhibitId(LOCAL_ACCOUNT_ID, LOCAL_CALENDAR_ID, row.id);
  return {
    id: row.id,
    accountId: LOCAL_ACCOUNT_ID,
    calendarId: LOCAL_CALENDAR_ID,
    calendarSummary: "Local",
    calendarColor: null,
    title: row.title,
    description: row.description,
    location: row.location,
    descriptionRich: row.descriptionRich,
    locationRich: row.locationRich,
    allDay: row.allDay,
    start: row.start,
    end: row.end,
    htmlLink: null,
    // A local event has no organizer/guest concept - the owner can always
    // edit or delete it.
    editable: true,
    // Never a real Google invitation - "not attending" is always just the
    // same private local note a non-invitation Google event gets (see
    // attendance.ts's resolveAttendance), keyed by this event's own
    // exhibit id exactly like that table already supports for any string.
    attendance: resolveAttendance({ isInvitation: false, responseStatus: null }, exhibitId),
  };
}

function startMsOf(event: CalendarEvent): number {
  return new Date(event.start).getTime();
}

export function listLocalEvents(fromISO: string, toISO: string): CalendarEvent[] {
  const fromMs = new Date(fromISO).getTime();
  const toMs = new Date(toISO).getTime();
  return db
    .select()
    .from(localEvents)
    .all()
    .map(rowToCalendarEvent)
    .filter((event) => !event.attendance.notAttending && startMsOf(event) >= fromMs && startMsOf(event) <= toMs)
    .sort((a, b) => startMsOf(a) - startMsOf(b));
}

// Mirrors google/cache.ts's searchCachedEvents exactly (same empty-query
// "upcoming only" default, same relevance ranking on a non-empty query) -
// kept as its own copy rather than a shared helper since the two query
// different tables and there's no clean shared shape worth the indirection
// for logic this small.
export function searchLocalEvents(query: string, limit = 20): CalendarEvent[] {
  const trimmed = query.trim();
  if (!trimmed) {
    const nowMs = Date.now();
    return db
      .select()
      .from(localEvents)
      .all()
      .map(rowToCalendarEvent)
      .filter((event) => startMsOf(event) >= nowMs)
      .sort((a, b) => startMsOf(a) - startMsOf(b))
      .slice(0, limit);
  }
  return db
    .select()
    .from(localEvents)
    .where(or(like(localEvents.title, `%${trimmed}%`), like(localEvents.description, `%${trimmed}%`), like(localEvents.location, `%${trimmed}%`)))
    .all()
    .map(rowToCalendarEvent)
    .sort((a, b) => startMsOf(a) - startMsOf(b))
    .map((event) => ({
      event,
      score: scoreExhibitMatch(trimmed, [
        { text: event.title, isPrimary: true },
        { text: event.description ?? "", isPrimary: false },
        { text: event.location ?? "", isPrimary: false },
      ]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ event }) => event);
}

export function getLocalEvent(id: string): CalendarEvent | undefined {
  const row = db.select().from(localEvents).where(eq(localEvents.id, id)).get();
  return row ? rowToCalendarEvent(row) : undefined;
}

export class LocalEventNotFoundError extends Error {
  constructor(id: string) {
    super(`No such local event: ${id}`);
    this.name = "LocalEventNotFoundError";
  }
}

// Resolves descriptionRich/locationRich's exhibit tokens down to the plain
// text stored alongside them (used by plain-text search, and kept for
// symmetry with cachedEvents' own description/location) - no reconciliation
// branch the way google/cache.ts's resolveRichFields needs, since nothing
// outside this Chamber can ever edit a local event's text out from under
// it. Only a field this request actually touched (present in the returned
// `rich`) should be written - update below merges the rest from the
// existing row. This duplicates the shape of google/events.ts's own
// resolveRichAndPlainFields; kept separate rather than shared for the same
// reason google/cache.ts's own header comment gives for its own small
// duplications - importing across this pair would risk a cycle for a
// handful of lines that read cleanly by themselves.
async function resolveRichAndPlain(input: {
  description?: string;
  location?: string;
  descriptionRich?: string;
  locationRich?: string;
}): Promise<{
  plain: { description?: string; location?: string };
  rich: { descriptionRich?: string; locationRich?: string };
}> {
  const richDescription = input.descriptionRich ?? input.description;
  const richLocation = input.locationRich ?? input.location;

  const tokens = [
    ...(richDescription !== undefined ? extractExhibitTokensWithLabels(richDescription) : []),
    ...(richLocation !== undefined ? extractExhibitTokensWithLabels(richLocation) : []),
  ];
  const resolveLabel = await buildLabelResolver(tokens);

  const plain: { description?: string; location?: string } = {};
  const rich: { descriptionRich?: string; locationRich?: string } = {};
  if (richDescription !== undefined) {
    plain.description = projectRichToPlain(richDescription, resolveLabel);
    rich.descriptionRich = richDescription;
  }
  if (richLocation !== undefined) {
    plain.location = projectRichToPlain(richLocation, resolveLabel);
    rich.locationRich = richLocation;
  }
  return { plain, rich };
}

export interface LocalEventInput {
  title: string;
  description?: string;
  location?: string;
  descriptionRich?: string;
  locationRich?: string;
  allDay: boolean;
  start: string;
  end: string;
}

export async function insertLocalEvent(id: string, input: LocalEventInput): Promise<CalendarEvent> {
  const { plain, rich } = await resolveRichAndPlain(input);
  const now = new Date();
  const row: LocalEventRow = {
    id,
    title: input.title,
    description: plain.description ?? null,
    location: plain.location ?? null,
    descriptionRich: rich.descriptionRich ?? null,
    locationRich: rich.locationRich ?? null,
    allDay: input.allDay,
    start: toRfc3339DateTime(input.start),
    end: toRfc3339DateTime(input.end),
    createdAt: now,
    updatedAt: now,
  };
  db.insert(localEvents).values(row).run();
  return rowToCalendarEvent(row);
}

export interface LocalEventUpdateInput {
  title?: string;
  description?: string;
  location?: string;
  descriptionRich?: string;
  locationRich?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
}

export async function updateLocalEventRow(id: string, input: LocalEventUpdateInput): Promise<CalendarEvent> {
  const existing = db.select().from(localEvents).where(eq(localEvents.id, id)).get();
  if (!existing) throw new LocalEventNotFoundError(id);
  const { plain, rich } = await resolveRichAndPlain(input);
  const row: LocalEventRow = {
    ...existing,
    title: input.title ?? existing.title,
    description: "description" in plain ? (plain.description ?? null) : existing.description,
    location: "location" in plain ? (plain.location ?? null) : existing.location,
    descriptionRich: "descriptionRich" in rich ? (rich.descriptionRich ?? null) : existing.descriptionRich,
    locationRich: "locationRich" in rich ? (rich.locationRich ?? null) : existing.locationRich,
    allDay: input.allDay ?? existing.allDay,
    start: input.start !== undefined ? toRfc3339DateTime(input.start) : existing.start,
    end: input.end !== undefined ? toRfc3339DateTime(input.end) : existing.end,
    updatedAt: new Date(),
  };
  db.update(localEvents).set(row).where(eq(localEvents.id, id)).run();
  return rowToCalendarEvent(row);
}

// Returns the deleted row's own snapshot (rather than void, the way
// google/events.ts's deleteEvent fetches the event first) so the caller can
// publish a calendar.event_deleted event carrying its title without a
// separate read.
export function deleteLocalEventRow(id: string): CalendarEvent {
  const existing = db.select().from(localEvents).where(eq(localEvents.id, id)).get();
  if (!existing) throw new LocalEventNotFoundError(id);
  db.delete(localEvents).where(eq(localEvents.id, id)).run();
  return rowToCalendarEvent(existing);
}
