import { parseExhibitToken } from "@congress/shared-types";
import type { ExhibitSearchResult, ExhibitResolveResult, ExhibitSyncRequest } from "@congress/shared-types";
import { env } from "./env.js";
import { googleCalendarFetch } from "./google/client.js";
import { getAccountRow } from "./google/accounts.js";
import { listSelectedCalendarsInternal } from "./google/calendars.js";

// Deliberately talks directly to the low-level Google client/account
// lookups, not to google/events.ts's getEvent/listEvents - events.ts already
// depends on this module (to push a sync on create/update/delete), and
// having this module call back into events.ts would create a cycle.

const EVENT_ID_PREFIX = "event-";
const SEARCH_WINDOW_DAYS = 180;

export function toExhibitId(accountId: number, calendarId: string, eventId: string): string {
  return `${EVENT_ID_PREFIX}${accountId}:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

export function parseExhibitId(id: string): { accountId: number; calendarId: string; eventId: string } | null {
  if (!id.startsWith(EVENT_ID_PREFIX)) return null;
  const parts = id.slice(EVENT_ID_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [accountIdStr, encCalendarId, encEventId] = parts;
  const accountId = Number(accountIdStr);
  if (!Number.isInteger(accountId)) return null;
  return { accountId, calendarId: decodeURIComponent(encCalendarId!), eventId: decodeURIComponent(encEventId!) };
}

function eventUrl(accountId: number, calendarId: string, eventId: string): string {
  return `/e/${accountId}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
}

// Outgoing refs are bare Exhibit ids (e.g. "note-3"), matching the id space
// used by Capitol's exhibit_cache/exhibit_refs - not the "exhibit:chamber:id"
// token syntax, which only exists for embedding a reference in text. Same
// shape as chamber-notes/src/notes.ts's extractOutgoingExhibitRefs.
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
export function extractOutgoingExhibitRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
}

interface GoogleEventListItem {
  id: string;
  summary?: string;
}

export async function searchEventExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const trimmed = query.trim();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // A non-empty query also looks slightly into the past (someone referencing
  // a recent meeting), an empty query ("show me what's there") only looks
  // forward - matching the picker's upcoming-agenda-like default.
  const timeMin = new Date(trimmed ? now - SEARCH_WINDOW_DAYS * dayMs : now).toISOString();
  const timeMax = new Date(now + SEARCH_WINDOW_DAYS * dayMs).toISOString();

  const results: ExhibitSearchResult[] = [];
  for (const sel of listSelectedCalendarsInternal()) {
    if (results.length >= limit) break;
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
      )) as { items?: GoogleEventListItem[] };
      for (const raw of body.items ?? []) {
        results.push({
          id: toExhibitId(sel.accountId, sel.googleCalendarId, raw.id),
          type: "event",
          name: raw.summary ?? "(untitled)",
          url: eventUrl(sel.accountId, sel.googleCalendarId, raw.id),
        });
      }
    } catch {
      // A single calendar/account being unreachable (needs reconnect, API
      // error) shouldn't fail the whole search - same per-account isolation
      // as listEvents in google/events.ts.
    }
  }
  return results.slice(0, limit);
}

export async function resolveEventExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ExhibitResolveResult> => {
      const parsed = parseExhibitId(id);
      if (!parsed) return { id, deleted: true };

      const account = getAccountRow(parsed.accountId);
      if (!account) return { id, deleted: true };

      try {
        const raw = (await googleCalendarFetch(
          account,
          `/calendars/${encodeURIComponent(parsed.calendarId)}/events/${encodeURIComponent(parsed.eventId)}`
        )) as { summary?: string; status?: string };
        if (raw.status === "cancelled") return { id, deleted: true };
        return {
          id,
          name: raw.summary ?? "(untitled)",
          url: eventUrl(parsed.accountId, parsed.calendarId, parsed.eventId),
        };
      } catch {
        // Covers a real 404 and an account needing reconnect alike - the
        // per-chamber resolve contract only distinguishes resolved/deleted,
        // not degraded states (Capitol's own "unavailable" already covers
        // "the whole chamber is unreachable" one layer up).
        return { id, deleted: true };
      }
    })
  );
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN,
  };
}

export async function pushExhibitSync(push: Omit<ExhibitSyncRequest, "chamber">): Promise<void> {
  try {
    const res = await fetch(`${env.CAPITOL_URL}/capitol/exhibits/sync`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chamber: "calendar", ...push }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`Exhibit sync rejected by Capitol: ${res.status}`);
    }
  } catch (err) {
    console.warn(`Exhibit sync failed: ${(err as Error).message}`);
  }
}
