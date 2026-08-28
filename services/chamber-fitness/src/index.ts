import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startHevySync, stopHevySync } from "./hevy/poller.js";

createChamberBootstrap({ displayName: "Fitness Chamber", manifest, app, env, runMigrations, closeDb });

startHevySync();

process.on("SIGINT", stopHevySync);
process.on("SIGTERM", stopHevySync);
