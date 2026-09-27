import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app, startHeartbeatSweep, stopHeartbeatSweep } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { importLegacyChamberData } from "./legacyImport.js";
import { startEventCatalogSync, stopEventCatalogSync } from "./eventCatalogSync.js";
import { startHistoryPruneSweep, stopHistoryPruneSweep } from "./eventHistory.js";
import { importLegacyDeputySettings } from "./ai/legacyImport.js";
import { startAiRetentionSweep, stopAiRetentionSweep } from "./ai/retention.js";
import { recoverInterruptedThreads } from "./ai/chat.js";
import { startAskTimer, stopAskTimer } from "./ai/asks.js";
import { startTrackingScheduler, stopTrackingScheduler } from "./ai/tracking.js";
import { listTracking } from "./ai/memory.js";
import { startProactive, stopProactive } from "./ai/proactive.js";

runMigrations();
importLegacyChamberData();
importLegacyDeputySettings();
recoverInterruptedThreads();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Congress listening on http://${info.address}:${info.port}`);
});

startHeartbeatSweep();
startEventCatalogSync();
startHistoryPruneSweep();
startAiRetentionSweep();
startAskTimer();
startTrackingScheduler(() => listTracking(["active"]));
startProactive();

function shutdown() {
  console.log("Shutting down Congress...");
  stopHeartbeatSweep();
  stopEventCatalogSync();
  stopHistoryPruneSweep();
  stopAiRetentionSweep();
  stopAskTimer();
  stopTrackingScheduler();
  stopProactive();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
