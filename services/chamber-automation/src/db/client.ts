import { createDb } from "@congress/chamber-kit";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const { db, runMigrations, closeDb } = createDb(env.DB_PATH, schema);
