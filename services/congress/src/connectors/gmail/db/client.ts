import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "@congress/chamber-kit";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const gmailDbPath = () => join(env.CONNECTORS_DATA_DIR, "gmail.sqlite3");

const handle = createLazyDb(gmailDbPath, schema, MIGRATIONS_DIR);

export const gmailDb = handle.db;
export const runGmailMigrations = handle.runMigrations;
export const closeGmailDb = handle.closeDb;
