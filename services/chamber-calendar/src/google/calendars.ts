import { and, eq } from "drizzle-orm";
import type { GoogleCalendarListItem, SelectedCalendar } from "../types.js";
import { db } from "../db/client.js";
import { googleAccounts, selectedCalendars, cachedEvents } from "../db/schema.js";
import { googleCalendarFetch } from "./client.js";
import { getAccountRow } from "./accounts.js";

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export async function listGoogleCalendars(accountId: number): Promise<GoogleCalendarListItem[]> {
  const account = getAccountRow(accountId);
  if (!account) throw new Error(`No such account: ${accountId}`);
  const body = (await googleCalendarFetch(account, "/users/me/calendarList")) as {
    items?: GoogleCalendarListEntry[];
  };
  return (body.items ?? []).map((item) => ({
    googleCalendarId: item.id,
    summary: item.summary,
    backgroundColor: item.backgroundColor ?? null,
    primary: item.primary ?? false,
  }));
}

export function listSelectedCalendarsForUI(): SelectedCalendar[] {
  const rows = db
    .select({
      id: selectedCalendars.id,
      accountId: selectedCalendars.accountId,
      accountLabel: googleAccounts.label,
      googleCalendarId: selectedCalendars.googleCalendarId,
      summary: selectedCalendars.summary,
      colorHex: selectedCalendars.colorHex,
      selected: selectedCalendars.selected,
    })
    .from(selectedCalendars)
    .innerJoin(googleAccounts, eq(selectedCalendars.accountId, googleAccounts.id))
    .all();
  return rows;
}

export function listSelectedCalendarsInternal(): { accountId: number; googleCalendarId: string }[] {
  return db
    .select({ accountId: selectedCalendars.accountId, googleCalendarId: selectedCalendars.googleCalendarId })
    .from(selectedCalendars)
    .where(eq(selectedCalendars.selected, true))
    .all();
}

// Shared by google/events.ts (normalizing a live/write-path response) and
// google/cache.ts (normalizing a poll-sync response) - falls back to the
// raw calendar id/no color if the calendar was deselected between the
// event being cached and this lookup running.
export function calendarMeta(accountId: number, googleCalendarId: string): { summary: string; colorHex: string | null } {
  const row = db
    .select({ summary: selectedCalendars.summary, colorHex: selectedCalendars.colorHex })
    .from(selectedCalendars)
    .where(
      and(eq(selectedCalendars.accountId, accountId), eq(selectedCalendars.googleCalendarId, googleCalendarId))
    )
    .get();
  return row ?? { summary: googleCalendarId, colorHex: null };
}

export function getCalendarSyncToken(accountId: number, googleCalendarId: string): string | null {
  const row = db
    .select({ syncToken: selectedCalendars.syncToken })
    .from(selectedCalendars)
    .where(
      and(eq(selectedCalendars.accountId, accountId), eq(selectedCalendars.googleCalendarId, googleCalendarId))
    )
    .get();
  return row?.syncToken ?? null;
}

export function setCalendarSyncToken(accountId: number, googleCalendarId: string, syncToken: string | null): void {
  db.update(selectedCalendars)
    .set({ syncToken })
    .where(
      and(eq(selectedCalendars.accountId, accountId), eq(selectedCalendars.googleCalendarId, googleCalendarId))
    )
    .run();
}

export function setCalendarSelection(
  accountId: number,
  googleCalendarId: string,
  summary: string,
  colorHex: string | null | undefined,
  selected: boolean
): void {
  const existing = db
    .select({ id: selectedCalendars.id })
    .from(selectedCalendars)
    .where(
      and(eq(selectedCalendars.accountId, accountId), eq(selectedCalendars.googleCalendarId, googleCalendarId))
    )
    .get();

  if (existing) {
    db.update(selectedCalendars)
      .set({ summary, colorHex: colorHex ?? null, selected })
      .where(eq(selectedCalendars.id, existing.id))
      .run();
    // Deselecting stops syncOneCalendar from ever visiting this
    // (accountId, calendarId) pair again, so its cached rows would
    // otherwise sit stale forever instead of aging out of the sync
    // window like a still-selected calendar's do - purge them now
    // rather than leaving orphaned events behind (e.g. duplicates from a
    // calendar subscribed to under two different accounts, one of which
    // gets deselected).
    if (!selected) {
      db.delete(cachedEvents)
        .where(and(eq(cachedEvents.accountId, accountId), eq(cachedEvents.calendarId, googleCalendarId)))
        .run();
    }
    return;
  }

  db.insert(selectedCalendars)
    .values({ accountId, googleCalendarId, summary, colorHex: colorHex ?? null, selected })
    .run();
}
