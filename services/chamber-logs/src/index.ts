import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startHistoryPruneSweep, stopHistoryPruneSweep } from "./eventHistory.js";
import { startEventCatalogSync, stopEventCatalogSync } from "./eventCatalogSync.js";
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

// Keeps event_settings current with the live Chamber registry - see
// eventCatalogSync.ts. Registration/heartbeat above already retries with
// backoff if Congress isn't up yet at boot; this sweep self-heals the same
// way on its own interval, no separate backoff needed.
startEventCatalogSync();
process.on("SIGINT", stopEventCatalogSync);
process.on("SIGTERM", stopEventCatalogSync);
