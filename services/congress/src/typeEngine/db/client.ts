import { fileURLToPath } from "node:url";
import { createDb } from "@congress/chamber-kit";
import { env } from "../../env.js";
import { sqlCast } from "../casts.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

const handle = createDb(env.EXHIBITS_DB_PATH, schema);

// Raw handle for runtime tables; drizzle only knows the meta tables.
export const exhibitsSqlite = handle.sqlite;
export const exhibitsDb = handle.db;
export const closeExhibitsDb = handle.closeDb;

exhibitsSqlite.function("te_cast", { deterministic: true }, sqlCast);

export function runExhibitsMigrations(folder = MIGRATIONS_DIR): void {
  handle.runMigrations(folder);
}
