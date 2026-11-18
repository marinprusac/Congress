import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLazyDb } from "../../../kit/db.js";
import { env } from "../../../env.js";
import * as schema from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export const enableBankingDbPath = () => join(env.CONNECTORS_DATA_DIR, "enablebanking.sqlite3");

const handle = createLazyDb(enableBankingDbPath, schema, MIGRATIONS_DIR);

export const bankDb = handle.db;
export const runBankMigrations = handle.runMigrations;
export const closeBankDb = handle.closeDb;
