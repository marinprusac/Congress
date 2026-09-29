import { fileURLToPath } from "node:url";
import { defineChamber } from "@congress/chamber-kit";
import { initEnv } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { calendarManifest } from "./manifest.js";
import { registerTools } from "./mcp/tools.js";
import { startUpcomingEventNotifications, stopUpcomingEventNotifications } from "./notifications.js";
import { startCalendarCacheSync, stopCalendarCacheSync } from "./google/cache.js";
import { forgetAccount, migrateLegacyAccounts } from "./google/accounts.js";

// Loaded by Congress into its own process - see chamber-kit's module.ts.
export default defineChamber({
  manifest: calendarManifest,
  app,
  registerTools,
  dir: fileURLToPath(new URL("..", import.meta.url)),
  initEnv,
  start() {
    runMigrations();
    migrateLegacyAccounts();
    startCalendarCacheSync();
    startUpcomingEventNotifications();
  },
  stop() {
    stopCalendarCacheSync();
    stopUpcomingEventNotifications();
    closeDb();
  },
  subscriptions: () => [{ type: "google.account_disconnected" }],
  onEvent(event) {
    const accountId = event.payload.accountId;
    if (event.type === "google.account_disconnected" && typeof accountId === "number") forgetAccount(accountId);
  },
});
