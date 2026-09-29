import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";
import { startMailSync, stopMailSync, syncAll } from "./sync.js";
import { forgetAccount } from "./cache.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
export default defineChamber({
  manifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
    startMailSync();
  },
  stop() {
    stopMailSync();
    closeDb();
  },
  subscriptions: () => [{ type: "google.account_connected" }, { type: "google.account_disconnected" }],
  onEvent(event) {
    const accountId = event.payload.accountId;
    if (event.type === "google.account_disconnected" && typeof accountId === "number") forgetAccount(accountId);
    // A new or newly-granted account starts syncing right away.
    if (event.type === "google.account_connected") void syncAll();
  },
});
