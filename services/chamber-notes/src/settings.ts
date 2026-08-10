import { eq } from "drizzle-orm";
import type { NotesSettings, UpdateNotesSettingsRequest } from "@congress/shared-types";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";

const SETTINGS_ID = 1;

function toSettings(row: typeof settings.$inferSelect): NotesSettings {
  return { autoSave: row.autoSave };
}

export async function getSettings(): Promise<NotesSettings> {
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return row ? toSettings(row) : { autoSave: false };
}

export async function updateSettings(input: UpdateNotesSettingsRequest): Promise<NotesSettings> {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) {
    db.update(settings).set(input).where(eq(settings.id, SETTINGS_ID)).run();
  } else {
    db.insert(settings)
      .values({ id: SETTINGS_ID, autoSave: false, ...input })
      .run();
  }
  return getSettings();
}
