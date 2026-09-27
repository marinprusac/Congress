import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
// Start any pollers/timers in start() and stop them in stop().
export default defineChamber({
  manifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
  },
  stop() {
    closeDb();
  },
});
