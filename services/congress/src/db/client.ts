import { createDb } from "../kit/db.js";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const { db, sqlite, runMigrations, closeDb } = createDb(env.DB_PATH, schema);
