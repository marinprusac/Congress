import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";

createChamberBootstrap({ displayName: "Capitol Chamber", manifest, app, env, runMigrations, closeDb });
