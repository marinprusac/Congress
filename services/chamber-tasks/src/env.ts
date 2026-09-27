import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChamberEnv } from "@congress/chamber-kit";
import { z } from "zod";

// Relative paths resolve against this Chamber's folder, not Congress's cwd.
const chamberDir = fileURLToPath(new URL("..", import.meta.url));
const inChamber = (path: string) => resolve(chamberDir, path);

export const { env, initEnv } = defineChamberEnv(
  "tasks",
  z.object({
    DB_PATH: z.string().default("./data/tasks.sqlite3").transform(inChamber),
    // The owner's zone - a task is due until the end of its day here.
    OWNER_TIMEZONE: z
      .string()
      .default("Europe/Zagreb")
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "OWNER_TIMEZONE must be an IANA time zone"),
  })
);
