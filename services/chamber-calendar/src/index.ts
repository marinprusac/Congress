import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { calendarManifest } from "./manifest.js";
import { startUpcomingEventNotifications, stopUpcomingEventNotifications } from "./notifications.js";
import { startCalendarCacheSync, stopCalendarCacheSync } from "./google/cache.js";

createChamberBootstrap({ displayName: "Calendar Chamber", manifest: calendarManifest, app, env, runMigrations, closeDb });

startCalendarCacheSync();
startUpcomingEventNotifications();
process.on("SIGINT", stopCalendarCacheSync);
process.on("SIGINT", stopUpcomingEventNotifications);
process.on("SIGTERM", stopCalendarCacheSync);
process.on("SIGTERM", stopUpcomingEventNotifications);
