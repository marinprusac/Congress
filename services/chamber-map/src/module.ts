import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";
import { startTracking, stopTracking } from "./poller.js";
import { healTrackingStateOnBoot } from "./reprocess.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
export default defineChamber({
  manifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
    // Heal trip-linking state a previous restart lost before the poller builds on it. Logged, not fatal.
    void healTrackingStateOnBoot()
      .catch((error) => console.error("[map] boot-time tracking-state heal failed:", error))
      .then(startTracking);
  },
  stop() {
    stopTracking();
    closeDb();
  },
});
