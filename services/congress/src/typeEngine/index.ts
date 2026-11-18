import { registerLocalSource } from "../recordSources.js";
import { runRecordsMigrations } from "./db/client.js";
import { seedTypes } from "./seed.js";
import { typeEngineSource } from "./source.js";
import { backfillTitlePrefixes } from "./titleBackfill.js";

// Boot: meta migrations, the built-in types' seed, and the "e" record namespace.
export function startTypeEngine(): void {
  runRecordsMigrations();
  seedTypes();
  backfillTitlePrefixes();
  registerLocalSource(typeEngineSource);
}
