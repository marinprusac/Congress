import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function createDb<TSchema extends Record<string, unknown>>(dbPath: string, schema: TSchema) {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // WAL's own point: fsync only the WAL file on commit, not the main DB file
  // too (FULL, the better-sqlite3 default, fsyncs both) - still durable
  // across a process crash, only at risk from an OS-level power loss, which
  // this single-user VPS setup doesn't defend against further anyway. This
  // is the dominant cost of any single-row-at-a-time write loop (see
  // syncExhibit) until those get batched into real transactions.
  sqlite.pragma("synchronous = NORMAL");
  // ~16MB page cache (negative = KiB) instead of better-sqlite3's ~2MB
  // default - cheap given these are all small single-user databases, and it
  // keeps a table's hot pages resident across the unindexed scans elsewhere
  // in this codebase (see the "no index" list findings) instead of
  // re-reading from disk every time.
  sqlite.pragma("cache_size = -16000");
  // Multiple Chamber requests can land on the same SQLite file concurrently
  // (Node's single-threaded JS doesn't block on the synchronous better-
  // sqlite3 calls' own I/O) - without this, a writer holding the lock makes
  // a concurrent reader/writer fail immediately with SQLITE_BUSY instead of
  // waiting the way every other pragma default here already assumes.
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  function runMigrations(migrationsFolder = "./src/db/migrations") {
    migrate(db, { migrationsFolder });
  }

  function closeDb() {
    sqlite.close();
  }

  return { db, runMigrations, closeDb };
}
