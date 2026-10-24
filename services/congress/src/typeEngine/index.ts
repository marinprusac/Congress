import { registerLocalSource } from "../recordSources.js";
import { runRecordsMigrations } from "./db/client.js";
import { installPremades } from "./premade/index.js";
import { typeEngineSource } from "./source.js";

// Boot: meta migrations, premade types, and the "e" record namespace.
export function startTypeEngine(): void {
  runRecordsMigrations();
  installPremades();
  registerLocalSource(typeEngineSource);
}
