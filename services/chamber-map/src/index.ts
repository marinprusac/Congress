import { createChamberBootstrap } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { manifest } from "./manifest.js";
import { startTracking, stopTracking } from "./poller.js";
import { healTrackingStateOnBoot } from "./reprocess.js";

createChamberBootstrap({ displayName: "Map Chamber", manifest, app, env, runMigrations, closeDb });

// Heals any trip-linking state a previous restart lost (see this function's
// own comment) before the live poller starts building on top of it. Logged,
// not fatal - same "don't fail the whole boot over a rebuild" restraint as
// reprocessQuietly in places.ts.
healTrackingStateOnBoot()
  .catch((error) => {
    console.error("[chamber-map] boot-time tracking-state heal failed:", error);
    return null;
  })
  .then(startTracking);

process.on("SIGINT", stopTracking);
process.on("SIGTERM", stopTracking);
