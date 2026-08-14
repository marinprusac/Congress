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

  const db = drizzle(sqlite, { schema });

  function runMigrations(migrationsFolder = "./src/db/migrations") {
    migrate(db, { migrationsFolder });
  }

  function closeDb() {
    sqlite.close();
  }

  return { db, runMigrations, closeDb };
}
