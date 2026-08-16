import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { calendarManifest } from "./manifest.js";
import { startUpcomingEventNotifications, stopUpcomingEventNotifications } from "./notifications.js";

createChamberBootstrap({ displayName: "Calendar Chamber", manifest: calendarManifest, app, env, runMigrations, closeDb });

startUpcomingEventNotifications();
process.on("SIGINT", stopUpcomingEventNotifications);
process.on("SIGTERM", stopUpcomingEventNotifications);
