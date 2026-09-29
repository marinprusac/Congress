import { registerLocalSource } from "../exhibitSources.js";
import { runExhibitsMigrations } from "./db/client.js";
import { installPremades } from "./premade/index.js";
import { typeEngineSource } from "./source.js";
import { env } from "../env.js";
import { importLegacyNotes } from "./legacy/notesImport.js";

// Boot: meta migrations, premade types, and the "e" exhibit namespace.
export function startTypeEngine(): void {
  runExhibitsMigrations();
  installPremades();
  registerLocalSource(typeEngineSource);
  if (env.NOTES_IMPORT_ENABLED === "true") {
    const stats = importLegacyNotes(env.LEGACY_NOTES_DB_PATH);
    if (!stats.skipped) console.log("[types] imported notes:", stats);
  }
}
