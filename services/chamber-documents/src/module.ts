import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { documentsManifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";
import { env, initEnv } from "./env.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
export default defineChamber({
  manifest: documentsManifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
    mkdirSync(env.FILES_DIR, { recursive: true });
  },
  stop() {
    closeDb();
  },
});
