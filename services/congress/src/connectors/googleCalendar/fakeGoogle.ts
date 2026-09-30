import { sql } from "drizzle-orm";
import type { ConnectorContext } from "../contract.js";
import { GoogleApiError } from "../googleApi.js";
import { gcalDb } from "./db/client.js";
import type { RawAttendee, RawGoogleEvent } from "./facts.js";

// Test double for Google Calendar's REST API and the connector context.

export interface FakeAccount {
  id: number;
  label: string;
  email: string;
  needsReconnect: boolean;
  scopes: string[];
}

export function fakeGoogle() {
  const state = {
    accounts: [{ id: 1, label: "Me", email: "me@example.com", needsReconnect: false, scopes: [] }] as FakeAccount[],
    calendarList: { 1: [{ id: "primary", summary: "Me", primary: true }, { id: "work", summary: "Work" }] } as Record<number, { id: string; summary: string; primary?: boolean }[]>,
    // Returned by full syncs, and by incremental ones (then cleared).
    full: {} as Record<string, RawGoogleEvent[]>,
    changes: {} as Record<string, RawGoogleEvent[]>,
    expired: new Set<string>(),
    failing: new Set<number>(),
    // Replies to writes, keyed by "METHOD path".
    replies: {} as Record<string, unknown>,
    calls: [] as { method: string; url: string; body?: unknown }[],
    changesSeen: [] as { kind: string; key: string; deleted: boolean }[],
    resolved: [] as { email: string; evidence: string }[],
    // Existing People by email, and every find() asked.
    people: {} as Record<string, string>,
    found: [] as string[],
  };

  async function fetch(accountId: number, url: string, init?: RequestInit): Promise<unknown> {
    const method = init?.method ?? "GET";
    const u = new URL(url);
    state.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (state.failing.has(accountId)) throw new GoogleApiError(500, "boom");
    if (u.pathname.endsWith("/users/me/calendarList")) return { items: state.calendarList[accountId] ?? [] };
    const m = u.pathname.match(/\/calendars\/([^/]+)\/events$/);
    if (m && method === "GET") {
      const cal = `${accountId}/${decodeURIComponent(m[1]!)}`;
      if (u.searchParams.has("syncToken")) {
        if (state.expired.has(cal)) {
          state.expired.delete(cal);
          throw new GoogleApiError(410, "gone");
        }
        const items = state.changes[cal] ?? [];
        state.changes[cal] = [];
        return { items, nextSyncToken: `tok-${state.calls.length}` };
      }
      return { items: state.full[cal] ?? [], nextSyncToken: `tok-${state.calls.length}` };
    }
    const reply = state.replies[`${method} ${decodeURIComponent(u.pathname)}`];
    if (reply === undefined) throw new GoogleApiError(404, `no fake for ${method} ${u.pathname}`);
    return reply;
  }

  const ctx: ConnectorContext = {
    name: "google-calendar",
    google: { accounts: () => state.accounts, fetch },
    people: {
      find: (email) => {
        state.found.push(email);
        return state.people[email] ?? null;
      },
      resolve: (input, evidence) => {
        state.resolved.push({ email: input.email, evidence });
        return evidence === "corresponded" ? `person-${input.email}` : null;
      },
    },
    emitChange: (kind, key, deleted = false) => state.changesSeen.push({ kind, key, deleted }),
    publish: () => {},
    records: { idFor: () => null },
    syncNow: () => {},
    reschedule: () => {},
  };
  return { state, ctx };
}

const DAY = 86_400_000;

export function ev(
  id: string,
  opts: { day?: number; updated?: string; title?: string; organizerSelf?: boolean; guestsCanModify?: boolean; attendees?: RawAttendee[]; status?: string; allDay?: boolean } = {}
): RawGoogleEvent {
  const start = new Date(Date.now() + (opts.day ?? 1) * DAY);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    id,
    status: opts.status ?? "confirmed",
    updated: opts.updated ?? "u1",
    summary: opts.title ?? id,
    htmlLink: `https://calendar.google.com/${id}`,
    start: opts.allDay ? { date: start.toISOString().slice(0, 10) } : { dateTime: start.toISOString() },
    end: opts.allDay ? { date: end.toISOString().slice(0, 10) } : { dateTime: end.toISOString() },
    organizer: { email: opts.organizerSelf === false ? "boss@example.com" : "me@example.com", self: opts.organizerSelf !== false },
    guestsCanModify: opts.guestsCanModify,
    attendees: opts.attendees,
  };
}

export function resetGcalCache(): void {
  for (const table of ["accounts", "calendars", "events", "event_attendees", "settings"]) gcalDb.run(sql.raw(`delete from ${table}`));
}
