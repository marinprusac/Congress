import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { expiredDailies, runDailyBackups, backupDir } from "./backups.js";

describe("expiredDailies", () => {
  it("keeps the last 14 days and ignores other files", () => {
    const files = [
      "exhibits-daily-2026-09-30.sqlite3",
      "exhibits-daily-2026-09-17.sqlite3",
      "exhibits-daily-2026-09-16.sqlite3",
      "exhibits-daily-2026-01-01.sqlite3",
      "congress-daily-2026-01-01.sqlite3",
      "exhibits-prepublish-note-x.sqlite3",
    ];
    expect(expiredDailies(files, "exhibits", "2026-09-30")).toEqual([
      "exhibits-daily-2026-09-16.sqlite3",
      "exhibits-daily-2026-01-01.sqlite3",
    ]);
  });
});

describe("runDailyBackups", () => {
  it("writes one snapshot per day and prunes old ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "backups-test-"));
    const dbPath = join(dir, "exhibits.sqlite3");
    const sqlite = new Database(dbPath);
    sqlite.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (7)");
    mkdirSync(backupDir(dbPath), { recursive: true });
    writeFileSync(join(backupDir(dbPath), "exhibits-daily-2026-01-01.sqlite3"), "");

    const now = new Date("2026-09-30T03:00:00Z");
    expect(runDailyBackups([{ name: "exhibits", sqlite, dbPath }], now)).toHaveLength(1);
    expect(runDailyBackups([{ name: "exhibits", sqlite, dbPath }], now)).toHaveLength(0);
    expect(readdirSync(backupDir(dbPath))).toEqual(["exhibits-daily-2026-09-30.sqlite3"]);

    const copy = new Database(join(backupDir(dbPath), "exhibits-daily-2026-09-30.sqlite3"), { readonly: true });
    expect(copy.prepare("SELECT x FROM t").get()).toEqual({ x: 7 });
  });
});
