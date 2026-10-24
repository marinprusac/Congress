import { fileURLToPath } from "node:url";
import { createDb } from "../../kit/db.js";
import { env } from "../../env.js";
import { sqlCast } from "../casts.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

const handle = createDb(env.RECORDS_DB_PATH, schema);

// Raw handle for runtime tables; drizzle only knows the meta tables.
export const recordsSqlite = handle.sqlite;
export const recordsDb = handle.db;
export const closeRecordsDb = handle.closeDb;

recordsSqlite.function("te_cast", { deterministic: true }, sqlCast);

export function runRecordsMigrations(folder = MIGRATIONS_DIR): void {
  handle.runMigrations(folder);
}
