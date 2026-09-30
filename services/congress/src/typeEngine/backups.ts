import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";

// Nightly on-box snapshots via VACUUM INTO, kept for KEEP_DAYS days.

export const KEEP_DAYS = 14;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface BackupTarget {
  name: string;
  sqlite: Database.Database;
  dbPath: string;
}

export function backupDir(dbPath: string): string {
  return join(dirname(dbPath), "backups");
}

export function snapshot(sqlite: Database.Database, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path);
  sqlite.prepare("VACUUM INTO ?").run(path);
}

export function dailyFileName(name: string, day: string): string {
  return `${name}-daily-${day}.sqlite3`;
}

// Pure: which daily snapshots fall outside the retention window.
export function expiredDailies(files: string[], name: string, today: string, keepDays = KEEP_DAYS): string[] {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - (keepDays - 1) * 86_400_000;
  const prefix = `${name}-daily-`;
  return files.filter((f) => {
    if (!f.startsWith(prefix) || !f.endsWith(".sqlite3")) return false;
    const day = f.slice(prefix.length, -".sqlite3".length);
    const t = new Date(`${day}T00:00:00Z`).getTime();
    return Number.isFinite(t) && t < cutoff;
  });
}

export function runDailyBackups(targets: BackupTarget[], now = new Date()): string[] {
  const day = now.toISOString().slice(0, 10);
  const written: string[] = [];
  for (const t of targets) {
    const dir = backupDir(t.dbPath);
    const path = join(dir, dailyFileName(t.name, day));
    try {
      if (!existsSync(path)) {
        snapshot(t.sqlite, path);
        written.push(path);
      }
      for (const old of expiredDailies(readdirSync(dir), t.name, day)) rmSync(join(dir, old));
    } catch (err) {
      console.error(`[backups] ${t.name} failed:`, err);
    }
  }
  return written;
}

let timer: ReturnType<typeof setInterval> | null = null;

// `housekeeping` rides the same hourly tick (e.g. deleting orphaned files).
export function startBackups(targets: BackupTarget[], housekeeping?: () => void): void {
  const run = () => {
    runDailyBackups(targets);
    try {
      housekeeping?.();
    } catch (err) {
      console.error("[backups] housekeeping failed:", err);
    }
  };
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopBackups(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
