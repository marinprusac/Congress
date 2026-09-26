import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "../db/client.js";
import { aiSettings } from "../db/schema.js";
import { env } from "../env.js";

type AppDb = typeof defaultDb;

interface LegacyDeputySettingsRow {
  context_prompt: string;
  chat_idle_window_ms: number;
  budget_cap_usd: number;
  model: string;
  retention_days: number;
  paused: number;
  paused_reason: string | null;
}

// One-time copy of Deputy's own settings row (context prompt, model, budget
// cap, ...) into ai_settings, from before the AI engine moved into Congress.
// Self-disabling: it only runs while ai_settings has no row yet, so the
// owner's first save (or this import) ends it for good. Chat history and
// spend are deliberately not carried over - the thread is ephemeral and
// spend resets daily anyway. The Deputy file is opened read-only.
export function importLegacyDeputySettings(opts: { db?: AppDb; deputyDbPath?: string } = {}): boolean {
  const db = opts.db ?? defaultDb;
  const path = opts.deputyDbPath ?? env.LEGACY_DEPUTY_DB_PATH;

  if (db.select({ id: aiSettings.id }).from(aiSettings).where(eq(aiSettings.id, 1)).get()) return false;
  if (!existsSync(path)) return false;

  const source = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const hasTable = source.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get() !== undefined;
    if (!hasTable) return false;
    const row = source.prepare("SELECT * FROM settings WHERE id = 1").get() as LegacyDeputySettingsRow | undefined;
    if (!row || row.context_prompt === undefined) return false;

    db.insert(aiSettings)
      .values({
        id: 1,
        contextPrompt: row.context_prompt,
        chatIdleWindowMs: row.chat_idle_window_ms,
        budgetCapUsd: row.budget_cap_usd,
        model: row.model,
        retentionDays: row.retention_days,
        paused: row.paused === 1,
        pausedReason: row.paused_reason,
      })
      .onConflictDoNothing()
      .run();
    return true;
  } catch (err) {
    console.warn(`Legacy Deputy settings import failed: ${(err as Error).message}`);
    return false;
  } finally {
    source.close();
  }
}
