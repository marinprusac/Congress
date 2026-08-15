import { createSingleRowSettings } from "@congress/chamber-kit";
import type { TasksSettings } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

export const { getSettings, updateSettings } = createSingleRowSettings<typeof settings.$inferSelect, TasksSettings>({
  db,
  table: settings,
  toSettings: () => ({}),
  defaults: {},
});
