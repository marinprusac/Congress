import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startTracking, stopTracking } from "./poller.js";

createChamberBootstrap({ displayName: "Map Chamber", manifest, app, env, runMigrations, closeDb });

startTracking();
process.on("SIGINT", stopTracking);
process.on("SIGTERM", stopTracking);
