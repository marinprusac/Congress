import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8019),
    DB_PATH: z.string().default("./data/map.sqlite3"),
    // A self-hosted Traccar server: one static set of credentials, not a
    // multi-account OAuth dance like chamber-calendar's Google integration -
    // see src/traccar/client.ts.
    TRACCAR_URL: z.string().url(),
    TRACCAR_TOKEN: z.string().min(1, "TRACCAR_TOKEN must be set"),
    TRACCAR_DEVICE_ID: z.coerce.number().int().positive(),
    POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2 * 60 * 1000),
  })
);
