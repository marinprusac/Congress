import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./server.js";
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
import { importLegacyDirectives } from "./ai/legacyDirectivesImport.js";
import { loadChambers, stopChambers } from "./chambers/loader.js";
import { CHAMBER_MODULES } from "./chambers/modules.js";

runMigrations();
importLegacyChamberData();
importLegacyDeputySettings();
recoverInterruptedThreads();
await importLegacyDirectives();
// Every Chamber runs inside this process; a failing one is marked offline.
await loadChambers(CHAMBER_MODULES);

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Congress listening on http://${info.address}:${info.port}`);
});

startEventCatalogSync();
startHistoryPruneSweep();
startAiRetentionSweep();
startAskTimer();
startTrackingScheduler(() => listTracking(["active"]));
startProactive();

async function shutdown() {
  console.log("Shutting down Congress...");
  stopEventCatalogSync();
  stopHistoryPruneSweep();
  stopAiRetentionSweep();
  stopAskTimer();
  stopTrackingScheduler();
  stopProactive();
  await stopChambers();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
