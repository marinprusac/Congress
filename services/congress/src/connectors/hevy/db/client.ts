import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "@congress/chamber-kit";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const hevyDbPath = () => join(env.CONNECTORS_DATA_DIR, "hevy.sqlite3");

const handle = createLazyDb(hevyDbPath, schema, MIGRATIONS_DIR);

export const hevyDb = handle.db;
export const runHevyMigrations = handle.runMigrations;
export const closeHevyDb = handle.closeDb;
