import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8020),
    DB_PATH: z.string().default("./data/fitness.sqlite3"),
    // How often the Hevy poll loop checks for new/updated/deleted workouts.
    // Not owner-configurable via Settings (unlike chamber-map's
    // pollIntervalMs) - this doesn't need day-to-day tuning, so one fixed
    // default keeps the Settings surface to just the API key.
    HEVY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  })
);
