import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { calendarManifest } from "./manifest.js";

createChamberBootstrap({ displayName: "Calendar Chamber", manifest: calendarManifest, app, env, runMigrations, closeDb });
