import { createSingleRowSettings } from "@congress/chamber-kit";
import type { Settings } from "./types.js";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

const { getSettings, updateSettings: updateSettingsRaw } = createSingleRowSettings<
  typeof settings.$inferSelect,
  Settings
>({
  db,
  table: settings,
  toSettings: (row) => ({ hevyApiKey: row.hevyApiKey }),
  defaults: { hevyApiKey: null },
});

export { getSettings };

// Wrapped so pasting/clearing the Hevy API key triggers an immediate sync
// attempt instead of waiting up to HEVY_POLL_INTERVAL_MS for the next
// scheduled tick. Imports hevy/poller.js dynamically, at call time rather
// than at module load, purely to avoid a settings.ts <-> poller.ts import
// cycle - poller.ts itself calls getSettings() from this module.
export async function updateSettings(input: Partial<Settings>): Promise<Settings> {
  const updated = await updateSettingsRaw(input);
  if (input.hevyApiKey !== undefined) {
    const { syncNow } = await import("./hevy/poller.js");
    void syncNow();
  }
  return updated;
}
