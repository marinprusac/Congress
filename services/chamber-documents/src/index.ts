import { existsSync, mkdirSync } from "node:fs";
import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { documentsManifest } from "./manifest.js";

createChamberBootstrap({
  displayName: "Documents Chamber",
  manifest: documentsManifest,
  app,
  env,
  runMigrations,
  closeDb,
  beforeListen: () => {
    if (!existsSync(env.FILES_DIR)) mkdirSync(env.FILES_DIR, { recursive: true });
  },
});
