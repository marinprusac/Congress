import { and, eq } from "drizzle-orm";
import type { ConnectorContext } from "../contract.js";
import { gcalDb as db } from "./db/client.js";
import { accounts, calendars } from "./db/schema.js";
import { purgeCalendar } from "./cache.js";

export const API = "https://www.googleapis.com/calendar/v3";

interface RawCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
}

export type CalendarRow = typeof calendars.$inferSelect;

export async function fetchCalendarList(ctx: ConnectorContext, accountId: number): Promise<RawCalendar[]> {
  const items: RawCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams(pageToken ? { pageToken } : {});
    const body = (await ctx.google.fetch(accountId, `${API}/users/me/calendarList?${params}`)) as { items?: RawCalendar[]; nextPageToken?: string };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return items;
}

// Refreshes names and colors; new calendars start unselected, except the
// primary one the first time an account is seen.
export function storeCalendarList(accountId: number, list: RawCalendar[], seed: boolean): void {
  db.transaction((tx) => {
    for (const cal of list) {
      const meta = {
        summary: cal.summaryOverride ?? cal.summary ?? cal.id,
        color: cal.backgroundColor ?? null,
        accessRole: cal.accessRole ?? null,
        primary: cal.primary === true,
      };
      tx.insert(calendars)
        .values({ accountId, calendarId: cal.id, ...meta, selected: seed && cal.primary === true })
        .onConflictDoUpdate({ target: [calendars.accountId, calendars.calendarId], set: meta })
        .run();
    }
    if (seed) {
      tx.insert(accounts)
        .values({ accountId, seededAt: new Date() })
        .onConflictDoUpdate({ target: accounts.accountId, set: { seededAt: new Date() } })
        .run();
    }
  });
}

export async function ensureSeeded(ctx: ConnectorContext, accountId: number): Promise<void> {
  const row = db.select().from(accounts).where(eq(accounts.accountId, accountId)).get();
  if (row?.seededAt) return;
  storeCalendarList(accountId, await fetchCalendarList(ctx, accountId), true);
}

export function listCalendars(accountId?: number): CalendarRow[] {
  const all = db.select().from(calendars).all();
  return accountId === undefined ? all : all.filter((c) => c.accountId === accountId);
}

export function selectedCalendars(accountId: number): CalendarRow[] {
  return db
    .select()
    .from(calendars)
    .where(and(eq(calendars.accountId, accountId), eq(calendars.selected, true)))
    .all();
}

export function setSelected(accountId: number, calendarId: string, selected: boolean): boolean {
  const res = db
    .update(calendars)
    .set(selected ? { selected } : { selected, syncToken: null })
    .where(and(eq(calendars.accountId, accountId), eq(calendars.calendarId, calendarId)))
    .run();
  if (res.changes > 0 && !selected) purgeCalendar(accountId, calendarId);
  return res.changes > 0;
}

export function setSyncToken(accountId: number, calendarId: string, token: string | null): void {
  db.update(calendars)
    .set({ syncToken: token })
    .where(and(eq(calendars.accountId, accountId), eq(calendars.calendarId, calendarId)))
    .run();
}

export function recordAccountSync(accountId: number, error: string | null): void {
  const set = error ? { lastError: error } : { lastError: null, lastSyncedAt: new Date() };
  db.insert(accounts)
    .values({ accountId, ...set })
    .onConflictDoUpdate({ target: accounts.accountId, set })
    .run();
}

export function accountRows() {
  return db.select().from(accounts).all();
}
