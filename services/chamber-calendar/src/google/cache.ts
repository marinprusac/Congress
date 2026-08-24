import { and, eq, gte, lte, like, or } from "drizzle-orm";
import type { EventPublishRequest } from "@congress/shared-types";
import type { CalendarEvent } from "../types.js";
import { db } from "../db/client.js";
import { cachedEvents } from "../db/schema.js";
import { googleCalendarFetch, GoogleApiError } from "./client.js";
import { getAccountRow, AccountNeedsReconnectError } from "./accounts.js";
import { listSelectedCalendarsInternal, calendarMeta, getCalendarSyncToken, setCalendarSyncToken } from "./calendars.js";
import { toExhibitId } from "./eventId.js";
import { publishEvent } from "../events.js";
import { computeGoogleAttendance, resolveAttendance } from "../attendance.js";
import type { AttendanceStatus } from "../types.js";

// A disposable, rebuildable local mirror of a bounded window of Google
// Calendar's own event data - Google stays the source of truth (see
// db/schema.ts's cachedEvents table comment). Every read path in this
// Chamber (google/events.ts, exhibits.ts, the MCP tools, notifications.ts)
// reads through here instead of hitting Google live on every request; only
// this module and google/events.ts's own read/write-path fallbacks talk to
// Google directly for event data.

// Matches the ~6-month window this Chamber's search/MCP tooling already
// promised ("rolling ~6-month window centered on now") before this cache
// existed - the cache window is sized to fully cover that window, so
// searchCachedEvents never needs a live fallback.
const CACHE_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// How often the cache re-polls Google to discover changes made outside this
// Chamber's own write path (an edit made directly in Google Calendar) - same
// cadence the old notification-only poll used, so no increase in baseline
// Google API load versus before this cache existed.
const CACHE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

function windowBounds(): { startISO: string; endISO: string } {
  const now = Date.now();
  return {
    startISO: new Date(now - CACHE_WINDOW_DAYS * DAY_MS).toISOString(),
    endISO: new Date(now + CACHE_WINDOW_DAYS * DAY_MS).toISOString(),
  };
}

export function isWithinCacheWindow(fromISO: string, toISO: string): boolean {
  const { startISO, endISO } = windowBounds();
  return fromISO >= startISO && toISO <= endISO;
}

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

// Same shape google/events.ts's own private GoogleEvent interface reads,
// plus status/updated - the two fields only the cache-diff below needs.
// Kept as its own small duplicate (same spirit as the old SEARCH_WINDOW_DAYS
// duplication between exhibits.ts and google/events.ts) rather than
// importing google/events.ts's copy, since google/events.ts now depends on
// this module for reads and a back-import would cycle.
export interface RawGoogleEvent {
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
  attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
}

function isEventEditable(raw: RawGoogleEvent): boolean {
  const isOrganizer = raw.organizer ? raw.organizer.self === true : true;
  return isOrganizer || raw.guestsCanModify === true;
}

type CachedEventRow = typeof cachedEvents.$inferSelect;

function rowToCalendarEvent(row: CachedEventRow): CalendarEvent {
  return {
    id: row.eventId,
    accountId: row.accountId,
    calendarId: row.calendarId,
    calendarSummary: row.calendarSummary,
    calendarColor: row.calendarColor,
    title: row.title,
    description: row.description,
    location: row.location,
    allDay: row.allDay,
    start: row.start,
    end: row.end,
    htmlLink: row.htmlLink,
    editable: row.editable,
    attendance: resolveAttendance(
      { isInvitation: row.isInvitation, responseStatus: row.attendeeResponseStatus as AttendanceStatus | null },
      row.id
    ),
  };
}

// Builds the full cache row for an active (non-cancelled) raw Google event -
// shared by the poll-diff sync below and by google/events.ts's write-through
// on create/update.
export function toCacheRow(
  raw: RawGoogleEvent,
  accountId: number,
  calendarId: string
): typeof cachedEvents.$inferInsert {
  const allDay = Boolean(raw.start.date);
  const { summary, colorHex } = calendarMeta(accountId, calendarId);
  const attendance = computeGoogleAttendance(raw);
  return {
    id: toExhibitId(accountId, calendarId, raw.id),
    accountId,
    calendarId,
    eventId: raw.id,
    calendarSummary: summary,
    calendarColor: colorHex,
    title: raw.summary ?? "(untitled)",
    description: raw.description ?? null,
    location: raw.location ?? null,
    allDay,
    start: allDay ? raw.start.date! : raw.start.dateTime!,
    end: allDay ? raw.end.date! : raw.end.dateTime!,
    htmlLink: raw.htmlLink ?? null,
    editable: isEventEditable(raw),
    isInvitation: attendance.isInvitation,
    attendeeResponseStatus: attendance.responseStatus,
    googleUpdatedAt: raw.updated ?? new Date().toISOString(),
    syncedAt: new Date(),
  };
}

export function getCachedEvent(id: string): CalendarEvent | undefined {
  const row = db.select().from(cachedEvents).where(eq(cachedEvents.id, id)).get();
  return row ? rowToCalendarEvent(row) : undefined;
}

// Excludes anything marked not-attending (a real Google decline or a local
// note - see resolveAttendance) - the agenda is meant to show what you're
// actually going to, same as Google Calendar's own default view hiding
// declined events. Still reachable directly (getEvent) or via
// searchCachedEvents, which stays unfiltered - hiding from the passive
// agenda view isn't the same as making an event unfindable.
export function listCachedEvents(fromISO: string, toISO: string): CalendarEvent[] {
  const rows = db
    .select()
    .from(cachedEvents)
    .where(and(gte(cachedEvents.start, fromISO), lte(cachedEvents.start, toISO)))
    .all();
  return rows
    .map(rowToCalendarEvent)
    .filter((event) => !event.attendance.notAttending)
    .sort((a, b) => a.start.localeCompare(b.start));
}

// Empty query only looks forward from now (matches the picker's
// upcoming-agenda-like default); a non-empty query also looks slightly into
// the past - same split google/events.ts's old live searchEvents used, kept
// here since the whole cache table is already within the search window.
export function searchCachedEvents(query: string, limit = 20): CalendarEvent[] {
  const trimmed = query.trim();
  const conditions = trimmed
    ? [or(like(cachedEvents.title, `%${trimmed}%`), like(cachedEvents.description, `%${trimmed}%`), like(cachedEvents.location, `%${trimmed}%`))]
    : [gte(cachedEvents.start, new Date().toISOString())];
  const rows = db
    .select()
    .from(cachedEvents)
    .where(and(...conditions))
    .all();
  return rows
    .map(rowToCalendarEvent)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}

export function upsertCachedEventFromGoogle(raw: RawGoogleEvent, accountId: number, calendarId: string): CalendarEvent {
  const row = toCacheRow(raw, accountId, calendarId);
  const existing = db.select({ id: cachedEvents.id }).from(cachedEvents).where(eq(cachedEvents.id, row.id)).get();
  if (existing) {
    db.update(cachedEvents).set(row).where(eq(cachedEvents.id, row.id)).run();
  } else {
    db.insert(cachedEvents).values(row).run();
  }
  return rowToCalendarEvent(row as CachedEventRow);
}

export function deleteCachedEvent(id: string): void {
  db.delete(cachedEvents).where(eq(cachedEvents.id, id)).run();
}

function eventUrlFor(accountId: number, calendarId: string, eventId: string): string {
  return `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
}

type AccountRow = NonNullable<ReturnType<typeof getAccountRow>>;

// Follows `nextPageToken` to completion - Google paginates events.list, and
// the previous version only ever read the first page, so any calendar with
// more events than one page in the window silently lost the rest on every
// sync (never cached, never searchable, pruned as "outside the window" on
// the next tick). `nextSyncToken` is only ever present on the final page.
async function fetchAllEvents(
  account: AccountRow,
  calendarId: string,
  baseParams: Record<string, string>
): Promise<{ items: RawGoogleEvent[]; syncToken: string | undefined }> {
  const items: RawGoogleEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | undefined;
  do {
    const params = new URLSearchParams(baseParams);
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    )) as { items?: RawGoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (body.nextSyncToken) syncToken = body.nextSyncToken;
  } while (pageToken);
  return { items, syncToken };
}

async function syncOneCalendar(accountId: number, calendarId: string): Promise<void> {
  const account = getAccountRow(accountId);
  if (!account) return;

  const { startISO, endISO } = windowBounds();
  const fullSyncParams = {
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "true",
  };

  // A stored syncToken drives a cheap incremental sync (only what changed
  // since last time) instead of re-fetching and diffing the whole ~180-day
  // window every 5 minutes. Google returns 410 when a token has expired or
  // become invalid (e.g. after a long gap) - that forces one full resync to
  // re-establish a token, same as having none yet.
  const storedToken = getCalendarSyncToken(accountId, calendarId);
  let incremental = storedToken !== null;
  let items: RawGoogleEvent[];
  let nextSyncToken: string | undefined;
  try {
    if (incremental) {
      ({ items, syncToken: nextSyncToken } = await fetchAllEvents(account, calendarId, {
        syncToken: storedToken!,
        singleEvents: "true",
      }));
    } else {
      ({ items, syncToken: nextSyncToken } = await fetchAllEvents(account, calendarId, fullSyncParams));
    }
  } catch (err) {
    if (incremental && err instanceof GoogleApiError && err.status === 410) {
      incremental = false;
      ({ items, syncToken: nextSyncToken } = await fetchAllEvents(account, calendarId, fullSyncParams));
    } else {
      throw err;
    }
  }

  const existingRows = db
    .select()
    .from(cachedEvents)
    .where(and(eq(cachedEvents.accountId, accountId), eq(cachedEvents.calendarId, calendarId)))
    .all();
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const unseenIds = new Set(existingById.keys());
  const toPublish: Array<Omit<EventPublishRequest, "chamber">> = [];

  db.transaction((tx) => {
    for (const raw of items) {
      const exhibitId = toExhibitId(accountId, calendarId, raw.id);
      unseenIds.delete(exhibitId);
      const existing = existingById.get(exhibitId);

      if (raw.status === "cancelled") {
        if (existing) {
          tx.delete(cachedEvents).where(eq(cachedEvents.id, exhibitId)).run();
          toPublish.push({
            type: "calendar.event_deleted",
            payload: { accountId, calendarId, eventId: raw.id, title: existing.title },
          });
        }
        continue;
      }

      const row = toCacheRow(raw, accountId, calendarId);
      // Unlike a full sync (server-side filtered to the window already), an
      // incremental sync can return events anywhere on the calendar - drop
      // (or prune, if previously cached) anything that has moved outside the
      // window instead of caching it.
      if (incremental && (row.start < startISO || row.start > endISO)) {
        if (existing) tx.delete(cachedEvents).where(eq(cachedEvents.id, exhibitId)).run();
        continue;
      }

      if (!existing) {
        tx.insert(cachedEvents).values(row).run();
        toPublish.push({
          type: "calendar.event_created",
          payload: {
            accountId,
            calendarId,
            eventId: raw.id,
            title: row.title,
            url: eventUrlFor(accountId, calendarId, raw.id),
          },
        });
      } else if (existing.googleUpdatedAt !== row.googleUpdatedAt) {
        tx.update(cachedEvents).set(row).where(eq(cachedEvents.id, exhibitId)).run();
        toPublish.push({
          type: "calendar.event_updated",
          payload: {
            accountId,
            calendarId,
            eventId: raw.id,
            title: row.title,
            url: eventUrlFor(accountId, calendarId, raw.id),
          },
        });
      }
      // Otherwise unchanged since the last sync (or already written through by
      // this Chamber's own create/update path) - no-op, and importantly no
      // duplicate publish.
    }

    // Anything still unseen wasn't returned by Google at all this cycle. Only
    // meaningful for a full sync, whose window-scoped request is a complete
    // picture of what should exist - an incremental sync only ever returns
    // what changed, so "not seen" carries no information there and would
    // otherwise prune every untouched event on the very first incremental
    // cycle. A cancelled event within the window would have come back with
    // status: "cancelled" (handled above) - a row that's simply missing here
    // has drifted outside the window as time moves forward, so it's pruned
    // silently rather than treated as a deletion. A row still inside the
    // window but missing is left alone and reconciled on the next cycle,
    // rather than risking a false-deletion publish from a transient API hiccup.
    if (!incremental) {
      for (const id of unseenIds) {
        const row = existingById.get(id)!;
        if (row.start < startISO || row.start > endISO) {
          tx.delete(cachedEvents).where(eq(cachedEvents.id, id)).run();
        }
      }
    }
  });

  // Only ever move the stored token forward - Google always returns
  // `nextSyncToken` on a page-complete response, so a missing one here means
  // something unexpected happened upstream; leaving the previous token in
  // place just means the next cycle retries from the same point rather than
  // silently losing incremental-sync state.
  if (nextSyncToken) setCalendarSyncToken(accountId, calendarId, nextSyncToken);
  for (const event of toPublish) void publishEvent(event);
}

export async function syncCalendarCache(): Promise<void> {
  const selections = listSelectedCalendarsInternal();
  const byAccount = new Map<number, string[]>();
  for (const sel of selections) {
    const list = byAccount.get(sel.accountId) ?? [];
    list.push(sel.googleCalendarId);
    byAccount.set(sel.accountId, list);
  }

  for (const [accountId, calendarIds] of byAccount) {
    for (const calendarId of calendarIds) {
      try {
        await syncOneCalendar(accountId, calendarId);
      } catch (err) {
        if (err instanceof AccountNeedsReconnectError) {
          console.warn(`Calendar cache sync skipped account needing reconnect: ${err.label}`);
        } else {
          console.warn(`Calendar cache sync failed for ${calendarId}: ${(err as Error).message}`);
        }
      }
    }
  }
}

let syncInterval: ReturnType<typeof setInterval> | undefined;

export function startCalendarCacheSync(): void {
  void syncCalendarCache();
  syncInterval = setInterval(() => void syncCalendarCache(), CACHE_SYNC_INTERVAL_MS);
}

export function stopCalendarCacheSync(): void {
  if (syncInterval) clearInterval(syncInterval);
}
