import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app, startHeartbeatSweep, stopHeartbeatSweep } from "./server.js";
import { runMigrations, closeDb } from "./db/client.js";

runMigrations();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Capitol listening on http://${info.address}:${info.port}`);
});

startHeartbeatSweep();

function shutdown() {
  console.log("Shutting down Capitol...");
  stopHeartbeatSweep();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
