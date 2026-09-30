import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readChamberEnv } from "../chambers/loader.js";

// The retired-to-be Fitness Chamber's DB, read-only: the Hevy key and health
// token the connectors adopt when they have none. Goes with the cutover importer.
const FITNESS_DIR = fileURLToPath(new URL("../../../chamber-fitness", import.meta.url));

export function fitnessDbPath(): string {
  const configured = readChamberEnv(FITNESS_DIR).DB_PATH ?? "./data/fitness.sqlite3";
  return isAbsolute(configured) ? configured : resolve(FITNESS_DIR, configured);
}

export function legacyFitnessSettings(path = fitnessDbPath()): { hevyApiKey: string | null; healthIngestToken: string | null } | null {
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT hevy_api_key, health_ingest_token FROM settings WHERE id = 1").get() as
      | { hevy_api_key: string | null; health_ingest_token: string | null }
      | undefined;
    return row ? { hevyApiKey: row.hevy_api_key, healthIngestToken: row.health_ingest_token } : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
