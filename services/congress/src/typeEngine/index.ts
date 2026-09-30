import { registerLocalSource } from "../exhibitSources.js";
import { env } from "../env.js";
import { forgetChamber } from "../registry.js";
import { runExhibitsMigrations } from "./db/client.js";
import { installPremades } from "./premade/index.js";
import { typeEngineSource } from "./source.js";
import { importLegacyTasks } from "./legacy/tasksImport.js";
import { importLegacyDocuments } from "./legacy/documentsImport.js";

// Boot: meta migrations, premade types, and the "e" exhibit namespace.
export function startTypeEngine(): void {
  runExhibitsMigrations();
  installPremades();
  registerLocalSource(typeEngineSource);
  if (env.LEGACY_IMPORT_ENABLED === "true") {
    // Tasks first, so documents' refs to tasks map through their aliases.
    const tasks = importLegacyTasks();
    if (!tasks.skipped) console.log("[types] imported tasks:", tasks);
    const documents = importLegacyDocuments();
    if (!documents.skipped) console.log("[types] imported documents:", documents);
    forgetChamber("tasks");
    forgetChamber("documents");
  }
}
