import { registerLocalSource } from "../exhibitSources.js";
import { runExhibitsMigrations } from "./db/client.js";
import { installPremades } from "./premade/index.js";
import { typeEngineSource } from "./source.js";

// Boot: meta migrations, premade types, and the "e" exhibit namespace.
export function startTypeEngine(): void {
  runExhibitsMigrations();
  installPremades();
  registerLocalSource(typeEngineSource);
}
