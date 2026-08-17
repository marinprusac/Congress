import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startEventPoller, stopEventPoller } from "./eventPoller.js";

createChamberBootstrap({ displayName: "Notifications Chamber", manifest, app, env, runMigrations, closeDb });

startEventPoller();
process.on("SIGINT", stopEventPoller);
process.on("SIGTERM", stopEventPoller);
