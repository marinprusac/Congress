import { existsSync, mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, deregisterFromCapitol } from "./registerWithCapitol.js";

runMigrations();

if (!existsSync(env.FILES_DIR)) {
  mkdirSync(env.FILES_DIR, { recursive: true });
}

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Documents Chamber listening on http://${info.address}:${info.port}`);
});

registerWithCapitolUntilSuccess().then(() => {
  startHeartbeat();
});

async function shutdown() {
  console.log("Shutting down Documents Chamber...");
  stopHeartbeat();
  await deregisterFromCapitol();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
