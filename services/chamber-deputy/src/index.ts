import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startEventPoller, stopEventPoller } from "./eventPoller.js";
import { startRetentionSweep, stopRetentionSweep } from "./retention.js";

createChamberBootstrap({ displayName: "Deputy Chamber", manifest, app, env, runMigrations, closeDb });

startEventPoller();
startRetentionSweep();

function shutdown() {
  stopEventPoller();
  stopRetentionSweep();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
