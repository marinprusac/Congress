import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Relative paths resolve against this Chamber's folder, not Congress's cwd.
const chamberDir = fileURLToPath(new URL("..", import.meta.url));
const inChamber = (path: string) => resolve(chamberDir, path);

export const { env, initEnv } = defineChamberEnv(
  "map",
  z.object({
    DB_PATH: z.string().default("./data/map.sqlite3").transform(inChamber),
    // A self-hosted Traccar server: one static set of credentials, not a
    // multi-account OAuth dance like chamber-calendar's Google integration -
    // see src/traccar/client.ts.
    TRACCAR_URL: z.string().url(),
    TRACCAR_TOKEN: z.string().min(1, "TRACCAR_TOKEN must be set"),
    TRACCAR_DEVICE_ID: z.coerce.number().int().positive(),
  })
);
