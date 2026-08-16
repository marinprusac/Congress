import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { tasksManifest } from "./manifest.js";
import { startDueTaskNotifications, stopDueTaskNotifications } from "./notifications.js";

createChamberBootstrap({ displayName: "Tasks Chamber", manifest: tasksManifest, app, env, runMigrations, closeDb });

startDueTaskNotifications();
process.on("SIGINT", stopDueTaskNotifications);
process.on("SIGTERM", stopDueTaskNotifications);
