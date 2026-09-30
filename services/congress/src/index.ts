import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb, sqlite } from "./db/client.js";
import { closeExhibitsDb, exhibitsSqlite } from "./typeEngine/db/client.js";
import { startTypeEngine } from "./typeEngine/index.js";
import { importPersonNotes } from "./typeEngine/legacy/personNotes.js";
import { startBackups, stopBackups } from "./typeEngine/backups.js";
import { collectOrphans } from "./typeEngine/files.js";
import { startTimeTriggers, stopTimeTriggers } from "./typeEngine/triggers.js";
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
import { startConnectors, stopConnectors } from "./connectors/registry.js";
import { CONNECTORS } from "./connectors/list.js";

runMigrations();
startTypeEngine();
importPersonNotes();
importLegacyChamberData();
importLegacyDeputySettings();
recoverInterruptedThreads();
await importLegacyDirectives();
// Every Chamber runs inside this process; a failing one is marked offline.
await loadChambers(CHAMBER_MODULES);
await startConnectors(CONNECTORS);

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Congress listening on http://${info.address}:${info.port}`);
});

startEventCatalogSync();
startBackups(
  [
    { name: "exhibits", sqlite: exhibitsSqlite, dbPath: env.EXHIBITS_DB_PATH },
    { name: "congress", sqlite, dbPath: env.DB_PATH },
  ],
  () => collectOrphans()
);
await startTimeTriggers();
startHistoryPruneSweep();
startAiRetentionSweep();
startAskTimer();
startTrackingScheduler(() => listTracking(["active"]));
startProactive();

async function shutdown() {
  console.log("Shutting down Congress...");
  stopEventCatalogSync();
  stopBackups();
  stopTimeTriggers();
  stopHistoryPruneSweep();
  stopAiRetentionSweep();
  stopAskTimer();
  stopTrackingScheduler();
  stopProactive();
  await stopChambers();
  await stopConnectors();
  server.close(() => {
    closeDb();
    closeExhibitsDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
