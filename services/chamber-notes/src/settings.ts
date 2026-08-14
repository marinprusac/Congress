import { createSingleRowSettings } from "@congress/chamber-kit";
import type { NotesSettings } from "@congress/shared-types";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, NotesSettings>({
  db,
  table: settings,
  toSettings: (row) => ({ autoSave: row.autoSave }),
  defaults: { autoSave: false },
});
