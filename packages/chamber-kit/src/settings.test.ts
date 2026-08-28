import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./db.js";
import { createSingleRowSettings } from "./settings.js";

// A stand-in for any Chamber's own settings table - same single-row shape,
// exercised against a real SQLite file (which incidentally covers createDb's
// pragmas and directory creation too) rather than a hand-written fake, since
// the insert-vs-update branch is exactly where a fake would diverge.
const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  darkMode: integer("dark_mode", { mode: "boolean" }).notNull().default(false),
  label: text("label"),
});

interface Settings extends Record<string, unknown> {
  darkMode: boolean;
  label: string | null;
}

const { db, closeDb } = createDb(join(mkdtempSync(join(tmpdir(), "congress-settings-")), "nested", "settings.sqlite3"), {
  settings,
});

const api = createSingleRowSettings<typeof settings.$inferSelect, Settings>({
  db,
  table: settings,
  toSettings: (row) => ({ darkMode: row.darkMode, label: row.label }),
  defaults: { darkMode: false, label: null },
});

beforeEach(() => {
  db.run(sql`drop table if exists settings`);
  db.run(sql`create table settings (id integer primary key autoincrement, dark_mode integer not null default 0, label text)`);
});

afterAll(() => closeDb());

describe("createSingleRowSettings", () => {
  it("returns the defaults when no row has ever been written", async () => {
    await expect(api.getSettings()).resolves.toEqual({ darkMode: false, label: null });
  });

  it("inserts a row on the first write, filling unspecified fields from the defaults", async () => {
    await expect(api.updateSettings({ darkMode: true })).resolves.toEqual({ darkMode: true, label: null });
  });

  it("updates in place on subsequent writes rather than inserting a second row", async () => {
    await api.updateSettings({ darkMode: true });
    await api.updateSettings({ label: "home" });
    const rows = db.select().from(settings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(1);
  });

  it("leaves fields the caller did not mention untouched", async () => {
    await api.updateSettings({ darkMode: true, label: "home" });
    await expect(api.updateSettings({ label: "away" })).resolves.toEqual({ darkMode: true, label: "away" });
  });

  it("always writes to row id 1, so a Chamber only ever has one settings row", async () => {
    await api.updateSettings({ darkMode: true });
    expect(db.select().from(settings).all()[0]?.id).toBe(1);
  });

  it("reads back what it wrote", async () => {
    await api.updateSettings({ darkMode: true, label: "home" });
    await expect(api.getSettings()).resolves.toEqual({ darkMode: true, label: "home" });
  });
});
