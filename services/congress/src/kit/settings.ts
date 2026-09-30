import { eq } from "drizzle-orm";

const SETTINGS_ID = 1;

// Single-row settings table pattern: id is always 1, select-then-branch
// insert-if-missing/else-update. Used for chamber-wide (not per-device)
// preferences - e.g. Notes' autosave toggle, Capitol's dark mode - so every
// device agrees on the same value. `table`/`db` are left loosely typed
// (Drizzle's own generics are more trouble than they're worth to thread
// through a factory like this); the public boundary that matters -
// TSettings - stays strongly typed.
export interface SingleRowSettingsConfig<TRow extends { id: number }, TSettings extends Record<string, unknown>> {
  db: { select: () => any; update: (table: any) => any; insert: (table: any) => any };
  table: any;
  toSettings: (row: TRow) => TSettings;
  // Returned when no row exists yet, and also used as the insert row's base
  // values (spread under the caller's partial input) the first time a
  // setting is ever written.
  defaults: TSettings;
}

export function createSingleRowSettings<TRow extends { id: number }, TSettings extends Record<string, unknown>>(
  config: SingleRowSettingsConfig<TRow, TSettings>
) {
  const { db, table, toSettings, defaults } = config;

  async function getSettings(): Promise<TSettings> {
    const row = db.select().from(table).where(eq(table.id, SETTINGS_ID)).get() as TRow | undefined;
    return row ? toSettings(row) : defaults;
  }

  async function updateSettings(input: Partial<TSettings>): Promise<TSettings> {
    const existing = db.select().from(table).where(eq(table.id, SETTINGS_ID)).get();
    if (existing) {
      db.update(table).set(input).where(eq(table.id, SETTINGS_ID)).run();
    } else {
      db.insert(table)
        .values({ id: SETTINGS_ID, ...defaults, ...input })
        .run();
    }
    return getSettings();
  }

  return { getSettings, updateSettings };
}
