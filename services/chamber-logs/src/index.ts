import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startHistoryPruneSweep, stopHistoryPruneSweep } from "./eventHistory.js";
import { computeSubscriptions, setSubscriptionChangeNotifier } from "./subscriptions.js";

const { heartbeatNow } = createChamberBootstrap({
  displayName: "Logs Chamber",
  manifest,
  app,
  env,
  runMigrations,
  closeDb,
  getSubscriptions: computeSubscriptions,
});
setSubscriptionChangeNotifier(() => void heartbeatNow());

startHistoryPruneSweep();
process.on("SIGINT", stopHistoryPruneSweep);
process.on("SIGTERM", stopHistoryPruneSweep);
