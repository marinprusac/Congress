import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startEventPoller, stopEventPoller } from "./eventPoller.js";
import { startHistoryPruneSweep, stopHistoryPruneSweep } from "./eventHistory.js";

createChamberBootstrap({ displayName: "Logs Chamber", manifest, app, env, runMigrations, closeDb });

startEventPoller();
startHistoryPruneSweep();
process.on("SIGINT", () => {
  stopEventPoller();
  stopHistoryPruneSweep();
});
process.on("SIGTERM", () => {
  stopEventPoller();
  stopHistoryPruneSweep();
});
