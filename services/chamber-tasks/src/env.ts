import { chamberEnvSchema, loadEnv } from "@congress/chamber-kit";
import { z } from "zod";

export const env = loadEnv(
  chamberEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(8014),
    DB_PATH: z.string().default("./data/tasks.sqlite3"),
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
