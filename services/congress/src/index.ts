import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app, startHeartbeatSweep, stopHeartbeatSweep } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { importLegacyChamberData } from "./legacyImport.js";
import { startEventCatalogSync, stopEventCatalogSync } from "./eventCatalogSync.js";
import { startHistoryPruneSweep, stopHistoryPruneSweep } from "./eventHistory.js";
import { importLegacyDeputySettings } from "./ai/legacyImport.js";
import { startAiRetentionSweep, stopAiRetentionSweep } from "./ai/retention.js";

runMigrations();
importLegacyChamberData();
importLegacyDeputySettings();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Congress listening on http://${info.address}:${info.port}`);
});

startHeartbeatSweep();
startEventCatalogSync();
startHistoryPruneSweep();
startAiRetentionSweep();

function shutdown() {
  console.log("Shutting down Congress...");
  stopHeartbeatSweep();
  stopEventCatalogSync();
  stopHistoryPruneSweep();
  stopAiRetentionSweep();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
