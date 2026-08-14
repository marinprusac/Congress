import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8013),
    DB_PATH: z.string().default("./data/documents.sqlite3"),
    FILES_DIR: z.string().default("./data/documents-files"),
  })
);
