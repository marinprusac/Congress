import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { setCongressHost, type ChamberModule } from "@congress/chamber-kit";
import { RESERVED_CHAMBER_NAMES } from "@congress/shared-types";
import { publishEvent } from "../events.js";
import { resolveExhibits, syncExhibit } from "../exhibits.js";
import { markChamberOffline, registerChamber } from "../registry.js";
import { selfBaseUrl } from "../ai/mcpConfig.js";
import { addModule, listModules, removeModule } from "./runtime.js";

// What every loaded Chamber can call back into.
export function installCongressHost(): void {
  setCongressHost({ publishEvent, syncExhibit, resolveExhibits });
}

// A Chamber's own config lives in its own .env, never the shared process.env.
export function readChamberEnv(dir: string): Record<string, string> {
  const path = join(dir, ".env");
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

export interface LoadOptions {
  envFor?: (module: ChamberModule) => Record<string, string | undefined>;
}

// Starts one Chamber. A Chamber that fails is marked offline and skipped -
// it never takes Congress (or another Chamber) down with it.
export async function loadChamber(module: ChamberModule, opts: LoadOptions = {}): Promise<boolean> {
  const name = module.manifest.name;
  if ((RESERVED_CHAMBER_NAMES as readonly string[]).includes(name)) {
    console.error(`[${name}] not loaded: reserved name`);
    return false;
  }
  try {
    module.initEnv(opts.envFor ? opts.envFor(module) : readChamberEnv(module.dir));
    await module.start();
  } catch (err) {
    console.error(`[${name}] failed to start:`, err);
    await Promise.resolve()
      .then(() => module.stop())
      .catch(() => {});
    markChamberOffline(module.manifest);
    return false;
  }
  addModule(module);
  registerChamber({ ...module.manifest, mcpUrl: `${selfBaseUrl()}/mcp/${name}` }, module.subscriptions?.() ?? []);
  console.log(`[${name}] started`);
  return true;
}

export async function loadChambers(modules: ChamberModule[], opts: LoadOptions = {}): Promise<void> {
  installCongressHost();
  for (const module of modules) await loadChamber(module, opts);
}

export async function stopChambers(): Promise<void> {
  for (const module of listModules()) {
    try {
      await module.stop();
    } catch (err) {
      console.error(`[${module.manifest.name}] failed to stop:`, err);
    }
    removeModule(module.manifest.name);
  }
}
