import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Relative paths resolve against this Chamber's folder, not Congress's cwd.
const chamberDir = fileURLToPath(new URL("..", import.meta.url));
const inChamber = (path: string) => resolve(chamberDir, path);

export const { env, initEnv } = defineChamberEnv(
  "fitness",
  z.object({
    DB_PATH: z.string().default("./data/fitness.sqlite3").transform(inChamber),
    // How often the Hevy poll loop checks for new/updated/deleted workouts.
    // Not owner-configurable via Settings (unlike chamber-map's
    // pollIntervalMs) - this doesn't need day-to-day tuning, so one fixed
    // default keeps the Settings surface to just the API key.
    HEVY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  })
);
