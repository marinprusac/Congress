import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { tasksManifest } from "./manifest.js";

createChamberBootstrap({ displayName: "Tasks Chamber", manifest: tasksManifest, app, env, runMigrations, closeDb });
