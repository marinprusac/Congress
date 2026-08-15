import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(__CHAMBER_PORT__),
    DB_PATH: z.string().default("./data/__CHAMBER_NAME__.sqlite3"),
  })
);
