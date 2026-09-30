import { createSingleRowSettings } from "./kit/settings.js";
import type { CapitolSettings } from "@congress/shared-types";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, CapitolSettings>({
  db,
  table: settings,
  toSettings: (row) => ({ darkMode: row.darkMode, pinnedViews: row.pinnedViews }),
  defaults: { darkMode: false, pinnedViews: [] },
});
