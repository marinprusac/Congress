import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startRetentionSweep, stopRetentionSweep } from "./retention.js";
import { startPeriodicCheckup, stopPeriodicCheckup } from "./checkup.js";
import { computeSubscriptions } from "./subscriptions.js";

createChamberBootstrap({
  displayName: "Deputy Chamber",
  manifest,
  app,
  env,
  runMigrations,
  closeDb,
  getSubscriptions: computeSubscriptions,
});

startPeriodicCheckup();
startRetentionSweep();

function shutdown() {
  stopPeriodicCheckup();
  stopRetentionSweep();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
