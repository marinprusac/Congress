import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "./db/client.js";
import { eventSettings, notifications, pushSubscriptions, settings, widgetLayouts } from "./db/schema.js";
import { importLegacyChamberData } from "./legacyImport.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from widget_layouts`);
  db.run(sql`delete from event_settings`);
  db.run(sql`delete from event_history`);
  db.run(sql`delete from notifications`);
  db.run(sql`delete from push_subscriptions`);
  db.run(sql`delete from settings`);
});

// Minimal stand-ins for the retired Chambers' own files - only the columns
// legacyImport.ts copies, in the shapes those Chambers' schemas had.
function makeLegacyFiles() {
  const dir = mkdtempSync(join(tmpdir(), "legacy-import-"));
  const capitolPath = join(dir, "capitol.sqlite3");
  const logsPath = join(dir, "logs.sqlite3");

  const capitol = new Database(capitolPath);
  capitol.exec(`create table widget_layouts (scope text, chamber text, widget_id text, x integer, y integer, updated_at integer)`);
  const placement = capitol.prepare("insert into widget_layouts values (?, ?, ?, ?, ?, ?)");
  placement.run("desktop", "tasks", "due", 0, 0, 1);
  placement.run("mobile", "tasks", "due", 1, 2, 1);
  placement.run("desktop", "logs", "bell", 3, 0, 1);
  placement.run("desktop", "logs", "recent-logs", 0, 1, 1);
  capitol.close();

  const logs = new Database(logsPath);
  logs.exec(`
    create table event_settings (id integer primary key autoincrement, event_type text unique, chamber text, label text, description text,
      payload_fields_json text, record_to_history integer, history_retention_ms integer, notify integer, notify_title_template text,
      notify_body_template text, notify_url_template text, notify_dedupe_key_template text, last_fired_at integer, created_at integer, updated_at integer);
    create table event_history (id integer primary key autoincrement, chamber text, type text, payload_json text, occurred_at integer, expires_at integer);
    create table notifications (id integer primary key autoincrement, chamber text, dedupe_key text, title text, body text, chamber_url text, created_at integer, read_at integer);
    create table push_subscriptions (id integer primary key autoincrement, endpoint text unique, p256dh text, auth text, created_at integer);
    insert into event_settings (event_type, chamber, label, record_to_history, notify, notify_title_template, created_at, updated_at)
      values ('tasks.overdue', 'tasks', 'Task overdue', 1, 1, '{{payload.name}} is overdue', 1, 1);
    insert into event_history (chamber, type, payload_json, occurred_at, expires_at) values ('tasks', 'tasks.overdue', '{"n":1}', 5, 9999999999999);
    insert into notifications (chamber, dedupe_key, title, created_at) values ('tasks', 'k', 'Overdue', 1);
    insert into push_subscriptions (endpoint, p256dh, auth, created_at) values ('https://push.example/1', 'p', 'a', 1);
  `);
  logs.close();

  return { capitolPath, logsPath };
}

describe("importLegacyChamberData", () => {
  it("copies layout (minus retired Logs widgets), event settings, history, notifications and push subscriptions", () => {
    const { capitolPath, logsPath } = makeLegacyFiles();

    const result = importLegacyChamberData({ capitolDbPath: capitolPath, logsDbPath: logsPath });

    expect(result).toEqual({ layouts: 2, eventSettings: 1, eventHistory: 1, notifications: 1, pushSubscriptions: 1 });
    expect(db.select().from(widgetLayouts).all().map((r) => r.chamber)).toEqual(["tasks", "tasks"]);
    expect(db.select().from(eventSettings).get()).toMatchObject({
      eventType: "tasks.overdue",
      recordToHistory: true,
      notify: true,
      notifyTitleTemplate: "{{payload.name}} is overdue",
    });
    // A legacy history row predating the actor column reads back with a null actor.
    expect(db.select().from(notifications).all()).toHaveLength(1);
    expect(db.select().from(pushSubscriptions).get()?.endpoint).toBe("https://push.example/1");
  });

  it("runs once: a second call is a no-op even if the files changed", () => {
    const { capitolPath, logsPath } = makeLegacyFiles();
    importLegacyChamberData({ capitolDbPath: capitolPath, logsDbPath: logsPath });
    db.run(sql`delete from widget_layouts`);

    expect(importLegacyChamberData({ capitolDbPath: capitolPath, logsDbPath: logsPath })).toBeNull();
    expect(db.select().from(widgetLayouts).all()).toHaveLength(0);
    expect(db.select().from(settings).get()?.legacyImportedAt).toBeInstanceOf(Date);
  });

  it("missing files are a no-op that still marks the import done", () => {
    const result = importLegacyChamberData({ capitolDbPath: "/nonexistent/a.sqlite3", logsDbPath: "/nonexistent/b.sqlite3" });

    expect(result).toEqual({ layouts: 0, eventSettings: 0, eventHistory: 0, notifications: 0, pushSubscriptions: 0 });
    expect(db.select().from(settings).get()?.legacyImportedAt).toBeInstanceOf(Date);
  });
});
