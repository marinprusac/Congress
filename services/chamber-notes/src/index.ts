import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { notesManifest } from "./manifest.js";

createChamberBootstrap({ displayName: "Notes Chamber", manifest: notesManifest, app, env, runMigrations, closeDb });
