import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "../../../kit/db.js";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const healthDbPath = () => join(env.CONNECTORS_DATA_DIR, "health.sqlite3");

const handle = createLazyDb(healthDbPath, schema, MIGRATIONS_DIR);

export const healthDb = handle.db;
export const runHealthMigrations = handle.runMigrations;
export const closeHealthDb = handle.closeDb;
