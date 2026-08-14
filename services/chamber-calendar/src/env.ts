import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8012),
    DB_PATH: z.string().default("./data/calendar.sqlite3"),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, "GOOGLE_OAUTH_CLIENT_ID must be set"),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, "GOOGLE_OAUTH_CLIENT_SECRET must be set"),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  })
);
