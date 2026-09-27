import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { db, runMigrations } from "../db/client.js";
import { importLegacyDeputySettings } from "./legacyImport.js";
import { getAiSettings, updateAiSettings } from "./settings.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from ai_settings`);
});

// A stand-in for Deputy's own file - just its settings table, in the shape
// Deputy's schema had before the AI engine moved into Congress.
function makeDeputyFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "legacy-deputy-")), "deputy.sqlite3");
  const deputy = new Database(path);
  deputy.exec(`create table settings (
    id integer primary key default 1, context_prompt text not null, chat_idle_window_ms integer not null,
    budget_cap_usd real not null, model text not null, retention_days integer not null,
    paused integer not null, paused_reason text)`);
  deputy.prepare("insert into settings values (1, ?, ?, ?, ?, ?, ?, ?)").run("I live in Zagreb.", 600000, 4, "claude-opus-5-5", 14, 0, null);
  deputy.close();
  return path;
}

describe("importLegacyDeputySettings", () => {
  it("copies Deputy's settings row into ai_settings", async () => {
    expect(importLegacyDeputySettings({ deputyDbPath: makeDeputyFile() })).toBe(true);

    expect(await getAiSettings()).toEqual({
      contextPrompt: "I live in Zagreb.",
      budgetCapUsd: 4,
      model: "claude-opus-5-5",
      retentionDays: 14,
      paused: false,
      pausedReason: null,
    });
  });

  it("never overwrites settings the owner already has", async () => {
    await updateAiSettings({ contextPrompt: "Newer context." });

    expect(importLegacyDeputySettings({ deputyDbPath: makeDeputyFile() })).toBe(false);
    expect((await getAiSettings()).contextPrompt).toBe("Newer context.");
  });

  it("skips quietly when there is no Deputy file", () => {
    expect(importLegacyDeputySettings({ deputyDbPath: "/nonexistent/deputy.sqlite3" })).toBe(false);
  });
});
