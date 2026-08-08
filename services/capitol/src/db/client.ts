import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

const dbDir = dirname(env.DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(env.DB_PATH);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  migrate(db, { migrationsFolder: "./src/db/migrations" });
}

export function closeDb() {
  sqlite.close();
}
