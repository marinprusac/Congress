import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { migrationsDir } from "@congress/test-support";
import { describe, expect, it } from "vitest";

// 0007 rebuilds the tables that referenced google_accounts; real data must survive it.
describe("migration 0007 (Google connector)", () => {
  it("keeps selections and cached events and drops their foreign keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "calendar-migration-"));
    const before = join(dir, "before");
    cpSync(migrationsDir("chamber-calendar"), before, { recursive: true });
    const journalPath = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.filter((e) => !e.tag.startsWith("0007"));
    writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(join(dir, "calendar.sqlite3"));
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: before });

    const now = Date.now();
    sqlite
      .prepare(
        "insert into google_accounts (id, label, email, google_sub, access_token, refresh_token, scope, token_expiry, needs_reconnect, connected_at, updated_at) values (3, 'Me', 'me@example.com', 'sub', 'at', 'rt', 'scope', ?, 0, ?, ?)"
      )
      .run(now, now, now);
    sqlite
      .prepare("insert into selected_calendars (account_id, google_calendar_id, summary, selected, sync_token) values (3, 'primary', 'Primary', 1, 'tok')")
      .run();
    sqlite
      .prepare(
        "insert into cached_events (id, account_id, calendar_id, event_id, calendar_summary, title, all_day, start, end, editable, google_updated_at, synced_at) values ('event-3:primary:e1', 3, 'primary', 'e1', 'Primary', 'Dentist', 0, '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 1, 'x', ?)"
      )
      .run(now);

    migrate(db, { migrationsFolder: migrationsDir("chamber-calendar") });

    expect(sqlite.prepare("select account_id, sync_token from selected_calendars").all()).toEqual([{ account_id: 3, sync_token: "tok" }]);
    expect(sqlite.prepare("select id, title from cached_events").all()).toEqual([{ id: "event-3:primary:e1", title: "Dentist" }]);

    // Emptying the legacy table (what migrateLegacyAccounts does) no longer cascades.
    sqlite.prepare("delete from google_accounts").run();
    expect(sqlite.prepare("select count(*) as n from selected_calendars").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("select count(*) as n from cached_events").get()).toEqual({ n: 1 });
    sqlite.close();
  });
});
