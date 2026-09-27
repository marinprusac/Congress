import { fileURLToPath } from "node:url";
import { createLazyDb } from "@congress/chamber-kit";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const { db, runMigrations, closeDb } = createLazyDb(
  () => env.DB_PATH,
  schema,
  fileURLToPath(new URL("./migrations", import.meta.url))
);
