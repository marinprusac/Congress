import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";
import { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, deregisterFromCapitol } from "./registerWithCapitol.js";

runMigrations();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Notes Chamber listening on http://${info.address}:${info.port}`);
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
