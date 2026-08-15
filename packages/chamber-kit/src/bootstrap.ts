import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { Manifest } from "@congress/shared-types";
import { createCapitolRegistration } from "./registerWithCapitol.js";

export interface ChamberBootstrapOptions {
  // e.g. "Notes Chamber" - used in the listening/shutdown log lines.
  displayName: string;
  manifest: Manifest;
  app: Hono<{ Bindings: HttpBindings }>;
  env: { HOST: string; PORT: number; CAPITOL_URL: string; CONGRESS_INTERNAL_TOKEN: string; HEARTBEAT_INTERVAL_MS: number };
  runMigrations: () => void;
  closeDb: () => void;
  // e.g. chamber-documents' FILES_DIR mkdir.
  beforeListen?: () => void;
}

// Standard boot sequence every Chamber (not Capitol - it's the registry
// owner, not a registrant, and runs a heartbeat sweep instead) follows:
// migrate, listen, register with Capitol and start heartbeating, and wire up
// a graceful SIGINT/SIGTERM shutdown that deregisters before closing the DB.
export function createChamberBootstrap(opts: ChamberBootstrapOptions): void {
  const { displayName, manifest, app, env, runMigrations, closeDb, beforeListen } = opts;

  runMigrations();
  beforeListen?.();

  const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
    console.log(`${displayName} listening on http://${info.address}:${info.port}`);
  });

  const { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, deregisterFromCapitol } =
    createCapitolRegistration({
      manifest,
      capitolUrl: env.CAPITOL_URL,
      internalToken: env.CONGRESS_INTERNAL_TOKEN,
      heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
    });

  registerWithCapitolUntilSuccess().then(() => startHeartbeat());

  async function shutdown() {
    console.log(`Shutting down ${displayName}...`);
    stopHeartbeat();
    await deregisterFromCapitol();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
