import { eq } from "drizzle-orm";
import type { CapitolSettings, UpdateCapitolSettingsRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

const SETTINGS_ID = 1;

function toSettings(row: typeof settings.$inferSelect): CapitolSettings {
  return { darkMode: row.darkMode };
}

export async function getSettings(): Promise<CapitolSettings> {
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return row ? toSettings(row) : { darkMode: false };
}

export async function updateSettings(input: UpdateCapitolSettingsRequest): Promise<CapitolSettings> {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) {
    db.update(settings).set(input).where(eq(settings.id, SETTINGS_ID)).run();
  } else {
    db.insert(settings)
      .values({ id: SETTINGS_ID, darkMode: false, ...input })
      .run();
  }
  return getSettings();
}
