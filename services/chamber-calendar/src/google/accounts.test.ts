import { migrationsDir } from "@congress/test-support";
import {
  setCongressHost,
  GoogleAccountNeedsReconnectError,
  GoogleScopeMissingError,
  type GoogleConnectorHost,
  type LegacyGoogleAccount,
} from "@congress/chamber-kit";
import type { GoogleAccount } from "@congress/shared-types";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, runMigrations } from "../db/client.js";
import { cachedEvents, legacyGoogleAccounts, selectedCalendars } from "../db/schema.js";
import { CALENDAR_SCOPES, ensureFreshAccessToken, forgetAccount, listAccounts, migrateLegacyAccounts } from "./accounts.js";

beforeAll(() => {
  runMigrations(migrationsDir("chamber-calendar"));
});

function account(id: number, scopes: string[]): GoogleAccount {
  return { id, label: `Account ${id}`, email: `a${id}@example.com`, scopes, needsReconnect: false, connectedAt: new Date().toISOString() };
}

let google: GoogleConnectorHost;

function install(overrides: Partial<GoogleConnectorHost>) {
  google = {
    listAccounts: () => [],
    getAccessToken: async () => "token",
    importLegacyAccounts: () => new Map(),
    ...overrides,
  };
  setCongressHost({ publishEvent: () => {}, syncExhibit: () => {}, resolveExhibits: async () => [], google });
}

function insertLegacy(id: number) {
  db.insert(legacyGoogleAccounts)
    .values({
      id,
      label: `Account ${id}`,
      email: `a${id}@example.com`,
      googleSub: `sub-${id}`,
      accessToken: "at",
      refreshToken: "rt",
      scope: CALENDAR_SCOPES.join(" "),
      tokenExpiry: new Date(0),
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

function insertSelection(accountId: number, calendarId: string) {
  db.insert(selectedCalendars).values({ accountId, googleCalendarId: calendarId, summary: calendarId, selected: true, syncToken: "tok" }).run();
}

function insertCachedEvent(accountId: number, eventId: string) {
  db.insert(cachedEvents)
    .values({
      id: `event-${accountId}:primary:${eventId}`,
      accountId,
      calendarId: "primary",
      eventId,
      calendarSummary: "Primary",
      title: "Event",
      allDay: false,
      start: "2026-10-01T10:00:00Z",
      end: "2026-10-01T11:00:00Z",
      editable: true,
      googleUpdatedAt: "x",
      syncedAt: new Date(),
    })
    .run();
}

beforeEach(() => {
  db.run("delete from google_accounts");
  db.run("delete from selected_calendars");
  db.run("delete from cached_events");
});

afterEach(() => setCongressHost(null));

describe("listAccounts", () => {
  it("flags accounts that haven't granted the Calendar scopes", () => {
    install({ listAccounts: () => [account(1, CALENDAR_SCOPES), account(2, ["https://www.googleapis.com/auth/gmail.readonly"])] });
    expect(listAccounts().map((a) => [a.id, a.hasAccess])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});

describe("ensureFreshAccessToken", () => {
  it("asks the connector for the Calendar scopes", async () => {
    const getAccessToken = vi.fn(async () => "fresh");
    install({ getAccessToken });
    await expect(ensureFreshAccessToken({ id: 1, label: "A" })).resolves.toBe("fresh");
    expect(getAccessToken).toHaveBeenCalledWith(1, CALENDAR_SCOPES);
  });

  it("reports a missing grant as needing reconnect", async () => {
    install({ getAccessToken: async () => Promise.reject(new GoogleScopeMissingError(1, "A", CALENDAR_SCOPES)) });
    await expect(ensureFreshAccessToken({ id: 1, label: "A" })).rejects.toThrow(GoogleAccountNeedsReconnectError);
  });
});

describe("migrateLegacyAccounts", () => {
  it("hands legacy accounts to the connector once and clears them", () => {
    const importLegacyAccounts = vi.fn((rows: LegacyGoogleAccount[]) => new Map(rows.map((r) => [r.id, r.id])));
    install({ importLegacyAccounts });
    insertLegacy(1);
    insertSelection(1, "primary");

    migrateLegacyAccounts();
    migrateLegacyAccounts();

    expect(importLegacyAccounts).toHaveBeenCalledTimes(1);
    expect(importLegacyAccounts.mock.calls[0]![0]).toMatchObject([{ id: 1, googleSub: "sub-1", refreshToken: "rt" }]);
    expect(db.select().from(legacyGoogleAccounts).all()).toEqual([]);
    expect(db.select().from(selectedCalendars).all()).toMatchObject([{ accountId: 1, syncToken: "tok" }]);
  });

  it("moves selections to a remapped id and drops that account's cached events", () => {
    install({ importLegacyAccounts: () => new Map([[1, 7]]) });
    insertLegacy(1);
    insertSelection(1, "primary");
    insertCachedEvent(1, "e1");

    migrateLegacyAccounts();

    expect(db.select().from(selectedCalendars).all()).toMatchObject([{ accountId: 7, syncToken: null }]);
    expect(db.select().from(cachedEvents).all()).toEqual([]);
  });

  it("keeps legacy rows when the connector isn't there", () => {
    setCongressHost(null);
    insertLegacy(1);
    expect(() => migrateLegacyAccounts()).toThrow();
    expect(db.select().from(legacyGoogleAccounts).all()).toHaveLength(1);
  });
});

describe("forgetAccount", () => {
  it("drops only the disconnected account's selections and cached events", () => {
    insertSelection(1, "primary");
    insertSelection(2, "primary");
    insertCachedEvent(1, "e1");
    insertCachedEvent(2, "e2");

    forgetAccount(1);

    expect(db.select().from(selectedCalendars).all().map((r) => r.accountId)).toEqual([2]);
    expect(db.select().from(cachedEvents).all().map((r) => r.accountId)).toEqual([2]);
  });
});
