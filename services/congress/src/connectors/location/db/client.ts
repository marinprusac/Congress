import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "@congress/chamber-kit";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const locationDbPath = () => join(env.CONNECTORS_DATA_DIR, "location.sqlite3");

const handle = createLazyDb(locationDbPath, schema, MIGRATIONS_DIR);

export const locationDb = handle.db;
export const runLocationMigrations = handle.runMigrations;
export const closeLocationDb = handle.closeDb;
