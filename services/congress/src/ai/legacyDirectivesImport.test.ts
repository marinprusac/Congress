import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../db/client.js";
import { importLegacyDirectives } from "./legacyDirectivesImport.js";
import { listTracking } from "./memory.js";
import { getAiSettings } from "./settings.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from ai_tracking`);
  db.run(sql`delete from ai_settings`);
  db.run(sql`delete from settings`);
  db.run(sql`delete from exhibit_cache`);
});

// Deputy's directives + directive_refs tables, as its last schema had them.
function makeDeputyFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "legacy-directives-")), "deputy.sqlite3");
  const deputy = new Database(path);
  deputy.exec(`
    create table directives (id integer primary key, title text not null, body text not null default '', enabled integer not null,
      schedule_type text, interval_ms integer, schedule_hour integer, schedule_minute integer, schedule_day_of_week integer,
      schedule_time_zone text, trigger_event_type text, last_run_at integer, created_at integer not null, updated_at integer not null);
    create table directive_refs (id integer primary key, directive_id integer not null, target_exhibit_id text not null, created_at integer not null);`);
  const insert = deputy.prepare(
    "insert into directives (id, title, body, enabled, schedule_type, interval_ms, schedule_hour, schedule_minute, schedule_day_of_week, schedule_time_zone, trigger_event_type, last_run_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  insert.run(1, "Morning brief", "Summarise my day.", 1, "daily", null, 8, 30, null, "Europe/Zagreb", null, null, 1, 1);
  insert.run(2, "Overdue nudges", "Nudge me about overdue tasks.", 1, "event", null, null, null, null, null, "tasks.overdue", 5, 1, 1);
  insert.run(3, "Weekly review", "Review the week.", 0, "weekly", null, 17, 0, 5, "Europe/Zagreb", null, null, 1, 1);
  insert.run(4, "Hourly", "Check stuff.", 1, "interval", 2 * 60 * 60 * 1000, null, null, null, null, null, null, 1, 1);
  insert.run(5, "Manual", "Only by hand.", 1, null, null, null, null, null, null, null, null, 1, 1);
  deputy.prepare("insert into directive_refs values (1, 1, 'note-3', 1)").run();
  deputy.prepare("insert into directive_refs values (2, 1, 'note-404', 1)").run();
  deputy.close();
  return path;
}

describe("importLegacyDirectives", () => {
  it("turns each directive into a tracked item with its schedule, trigger and refs", async () => {
    db.run(sql`insert into exhibit_cache (id, chamber, type, name, url, deleted, updated_at) values ('note-3', 'notes', 'note', 'Standup', '/n/3', 0, 0)`);
    const now = new Date("2026-09-27T12:00:00Z");

    expect(await importLegacyDirectives({ deputyDbPath: makeDeputyFile(), now })).toBe(5);

    const items = listTracking();
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(items.every((i) => i.source === "directive")).toBe(true);
    expect(byTitle["Morning brief"]).toMatchObject({
      status: "active",
      recurrence: { type: "daily", hour: 8, minute: 30 },
      // 08:30 in Zagreb (CEST) the next day.
      nextCheckAt: "2026-09-28T06:30:00.000Z",
      refs: ["[[exhibit:notes:note-3|Standup]]"],
    });
    expect(byTitle["Morning brief"]?.body).toContain("Summarise my day.");
    expect(byTitle["Overdue nudges"]).toMatchObject({ watchEvents: [{ type: "tasks.overdue", immediate: true }], recurrence: null, nextCheckAt: null });
    expect(byTitle["Weekly review"]).toMatchObject({ status: "paused", recurrence: { type: "weekly", dayOfWeek: 5, hour: 17, minute: 0 } });
    expect(byTitle["Hourly"]?.recurrence).toEqual({ type: "interval", everyMinutes: 120 });
    expect(byTitle["Manual"]).toMatchObject({ recurrence: null, watchEvents: [], nextCheckAt: null });
    expect((await getAiSettings()).timeZone).toBe("Europe/Zagreb");
  });

  it("runs once, and is a no-op without a file", async () => {
    const path = makeDeputyFile();
    await importLegacyDirectives({ deputyDbPath: path });
    expect(await importLegacyDirectives({ deputyDbPath: path })).toBeNull();
    expect(listTracking()).toHaveLength(5);

    db.run(sql`delete from settings`);
    db.run(sql`delete from ai_tracking`);
    expect(await importLegacyDirectives({ deputyDbPath: "/nope/deputy.sqlite3" })).toBe(0);
    expect(listTracking()).toHaveLength(0);
  });
});
