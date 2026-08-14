import { serve } from "@hono/node-server";
import { createCapitolRegistration } from "@congress/chamber-kit";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { notesManifest } from "./manifest.js";

runMigrations();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Notes Chamber listening on http://${info.address}:${info.port}`);
});

const { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, deregisterFromCapitol } =
  createCapitolRegistration({
    manifest: notesManifest,
    capitolUrl: env.CAPITOL_URL,
    internalToken: env.CONGRESS_INTERNAL_TOKEN,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  });

registerWithCapitolUntilSuccess().then(() => {
  startHeartbeat();
});

async function shutdown() {
  console.log("Shutting down Notes Chamber...");
  stopHeartbeat();
  await deregisterFromCapitol();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
