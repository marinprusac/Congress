import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { manifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";

// Loaded by Congress into its own process. All data lives in the wa-reader
// daemon (reader/), reached over its Unix socket; nothing to start or stop.
export default defineChamber({
  manifest,
  app,
  // Read-only tools so Congress's AI can read chats (src/mcp/tools.ts).
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {},
  stop() {},
});
