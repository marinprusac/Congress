import { eq } from "drizzle-orm";
import { createSingleRowSettings } from "@congress/chamber-kit";
import type { Settings, UpdateSettingsRequest } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

const SETTINGS_ID = 1;

function toSettings(row: typeof settings.$inferSelect): Settings {
  return { hiddenWidgets: JSON.parse(row.hiddenWidgetsJson) };
}

const defaults: Settings = { hiddenWidgets: [] };

export const { getSettings } = createSingleRowSettings<typeof settings.$inferSelect, Settings>({
  db,
  table: settings,
  toSettings,
  defaults,
});

// Not routed through createSingleRowSettings's generic updateSettings -
// hiddenWidgets is stored as JSON in a differently-named column
// (hiddenWidgetsJson), so it needs its own serialize step before hitting
// the table, which the generic select-then-insert-or-update can't do.
export async function updateSettings(input: UpdateSettingsRequest): Promise<Settings> {
  const patch: Partial<typeof settings.$inferInsert> = {};
  if (input.hiddenWidgets !== undefined) patch.hiddenWidgetsJson = JSON.stringify(input.hiddenWidgets);

  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) {
    db.update(settings).set(patch).where(eq(settings.id, SETTINGS_ID)).run();
  } else {
    db.insert(settings)
      .values({ id: SETTINGS_ID, hiddenWidgetsJson: JSON.stringify(defaults.hiddenWidgets), ...patch })
      .run();
  }
  return getSettings();
}
