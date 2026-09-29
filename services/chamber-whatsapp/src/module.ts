import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { manifest } from "./manifest.js";

// Loaded by Congress into its own process. All data lives in the wa-reader
// daemon (reader/), reached over its Unix socket; nothing to start or stop.
export default defineChamber({
  manifest,
  app,
  // Deliberately no MCP tools: the AI doesn't read WhatsApp.
  registerTools: () => {},
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {},
  stop() {},
});
