import { GoogleAccountNeedsReconnectError, GoogleScopeMissingError } from "@congress/chamber-kit";
import type { ConnectorContext, SyncResult } from "../contract.js";
import { GoogleApiError } from "../googleApi.js";
import { accountRows, API, ensureSeeded, recordAccountSync, selectedCalendars, setSyncToken, type CalendarRow } from "./calendars.js";
import { eventKey, eventsOfCalendar, forgetAccount, getSetting, markAttendee, normalizeEmail, pendingAttendees, removeEvent, writeEvent } from "./cache.js";
import { timeMs, type RawGoogleEvent } from "./facts.js";
import { attendeeEvidence, attendeesToResolve } from "./people.js";

const WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

// People from attendees ship switched off until the dry-run count is checked.
export const features = { people: false };

export function peopleActive(): boolean {
  return features.people && getSetting("people", true);
}

async function fetchAll(ctx: ConnectorContext, accountId: number, calendarId: string, params: Record<string, string>) {
  const items: RawGoogleEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | undefined;
  do {
    const query = new URLSearchParams(params);
    if (pageToken) query.set("pageToken", pageToken);
    const body = (await ctx.google.fetch(accountId, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${query}`)) as {
      items?: RawGoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (body.nextSyncToken) syncToken = body.nextSyncToken;
  } while (pageToken);
  return { items, syncToken };
}

// One calendar: incremental with a sync token, full over the window otherwise.
export async function syncCalendar(ctx: ConnectorContext, cal: CalendarRow, now = Date.now()): Promise<string[]> {
  const { accountId, calendarId } = cal;
  const from = now - WINDOW_DAYS * DAY_MS;
  const to = now + WINDOW_DAYS * DAY_MS;
  const full = {
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "true",
  };
  let incremental = cal.syncToken !== null;
  let result;
  try {
    result = await fetchAll(ctx, accountId, calendarId, incremental ? { syncToken: cal.syncToken!, singleEvents: "true" } : full);
  } catch (err) {
    if (!(incremental && err instanceof GoogleApiError && err.status === 410)) throw err;
    incremental = false;
    result = await fetchAll(ctx, accountId, calendarId, full);
  }

  const existing = new Map(eventsOfCalendar(accountId, calendarId).map((e) => [e.key, e]));
  const unseen = new Set(existing.keys());
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const raw of result.items) {
    const key = eventKey(accountId, calendarId, raw.id);
    unseen.delete(key);
    const prev = existing.get(key);
    const start = timeMs(raw.start);
    const outside = incremental && (start < from || start > to);
    if (raw.status === "cancelled" || outside) {
      if (prev && removeEvent(key)) deleted.push(key);
      continue;
    }
    if (prev && prev.googleUpdated === (raw.updated ?? null)) continue;
    writeEvent(raw, accountId, calendarId);
    changed.push(key);
  }
  // A full sync is the whole window: rows it didn't return have drifted out of it.
  if (!incremental) {
    for (const key of unseen) {
      const row = existing.get(key)!;
      if (row.startMs < from || row.startMs > to) {
        removeEvent(key);
        deleted.push(key);
      }
    }
  }
  if (result.syncToken) setSyncToken(accountId, calendarId, result.syncToken);
  for (const key of changed) ctx.emitChange("event", key);
  for (const key of deleted) ctx.emitChange("event", key, true);
  return changed;
}

// Links guests to People, creating them as the evidence allows. Covers every
// pending guest, so switching it on also reaches events synced before.
export function resolvePeople(ctx: ConnectorContext, ownEmails: Set<string>): number {
  let resolved = 0;
  const memo = new Map<string, string | null>();
  for (const a of pendingAttendees()) {
    const evidence = attendeeEvidence(a);
    if (attendeesToResolve([a], evidence, ownEmails).length === 0) continue;
    const memoKey = `${a.email} ${evidence}`;
    if (!memo.has(memoKey)) memo.set(memoKey, ctx.people.resolve({ email: a.email, name: a.displayName }, evidence));
    const personId = memo.get(memoKey)!;
    markAttendee(a.eventKey, a.email, personId, evidence);
    if (personId) resolved++;
  }
  return resolved;
}

export function friendlyError(err: unknown, label: string): string {
  if (err instanceof GoogleAccountNeedsReconnectError) return `${label} needs reconnecting`;
  if (err instanceof GoogleScopeMissingError) return `${label} hasn't granted calendar access`;
  return `${label}: ${(err as Error).message}`;
}

export async function syncAll(ctx: ConnectorContext): Promise<SyncResult> {
  const connected = ctx.google.accounts();
  const ids = new Set(connected.map((a) => a.id));
  for (const row of accountRows()) if (!ids.has(row.accountId)) forgetAccount(row.accountId);

  const ownEmails = new Set(connected.map((a) => normalizeEmail(a.email)));
  const failures: string[] = [];
  let changed = 0;
  for (const account of connected) {
    if (account.needsReconnect) {
      const msg = `${account.label} needs reconnecting`;
      recordAccountSync(account.id, msg);
      failures.push(msg);
      continue;
    }
    let errors: string[] = [];
    try {
      await ensureSeeded(ctx, account.id);
      const cals = selectedCalendars(account.id);
      const failed: { cal: CalendarRow; err: unknown }[] = [];
      for (const cal of cals) {
        try {
          changed += (await syncCalendar(ctx, cal)).length;
        } catch (err) {
          failed.push({ cal, err });
        }
      }
      // Every calendar failing the same way is one account problem.
      const messages = failed.map((f) => friendlyError(f.err, account.label));
      errors =
        failed.length > 1 && failed.length === cals.length && new Set(messages).size === 1
          ? [messages[0]!]
          : failed.map((f) => friendlyError(f.err, `${account.label} (${f.cal.summary})`));
    } catch (err) {
      errors = [friendlyError(err, account.label)];
    }
    recordAccountSync(account.id, errors.join("; ") || null);
    failures.push(...errors);
  }
  if (peopleActive()) resolvePeople(ctx, ownEmails);
  return { changed, error: failures.join("; ") || null };
}
