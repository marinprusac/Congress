import { createSingleRowSettings } from "@congress/chamber-kit";
import type { CalendarSettings } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, CalendarSettings>({
  db,
  table: settings,
  toSettings: (row) => ({ syncIntervalMinutes: row.syncIntervalMinutes }),
  defaults: { syncIntervalMinutes: 5 },
});
