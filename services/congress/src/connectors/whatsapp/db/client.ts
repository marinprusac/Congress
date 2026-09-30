import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "../../../kit/db.js";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const whatsappDbPath = () => join(env.CONNECTORS_DATA_DIR, "whatsapp.sqlite3");

const handle = createLazyDb(whatsappDbPath, schema, MIGRATIONS_DIR);

export const whatsappDb = handle.db;
export const runWhatsappMigrations = handle.runMigrations;
export const closeWhatsappDb = handle.closeDb;
