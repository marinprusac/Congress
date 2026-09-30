import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "../../../kit/db.js";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const gcalDbPath = () => join(env.CONNECTORS_DATA_DIR, "google-calendar.sqlite3");

const handle = createLazyDb(gcalDbPath, schema, MIGRATIONS_DIR);

export const gcalDb = handle.db;
export const runGcalMigrations = handle.runMigrations;
export const closeGcalDb = handle.closeDb;
