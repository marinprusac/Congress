import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { calendarManifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";
import { startUpcomingEventNotifications, stopUpcomingEventNotifications } from "./notifications.js";
import { startCalendarCacheSync, stopCalendarCacheSync } from "./google/cache.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
export default defineChamber({
  manifest: calendarManifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
    startCalendarCacheSync();
    startUpcomingEventNotifications();
  },
  stop() {
    stopCalendarCacheSync();
    stopUpcomingEventNotifications();
    closeDb();
  },
});
