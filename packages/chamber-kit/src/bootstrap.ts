import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { Manifest, ChamberSubscription } from "@congress/shared-types";
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
  // See registerWithCapitol.ts's own comment - omit for a Chamber that
  // never subscribes to events.
  getSubscriptions?: () => ChamberSubscription[];
}

export interface ChamberBootstrap {
  // Call after any mutation that could change this Chamber's own
  // getSubscriptions() result (a rule/automation/directive create/update/
  // delete/enable-toggle) to propagate it to Congress immediately instead
  // of waiting for the next scheduled heartbeat.
  heartbeatNow: () => Promise<void>;
}

// Standard boot sequence every Chamber (not Capitol - it's the registry
// owner, not a registrant, and runs a heartbeat sweep instead) follows:
// migrate, listen, register with Capitol and start heartbeating, and wire up
// a graceful SIGINT/SIGTERM shutdown that deregisters before closing the DB.
export function createChamberBootstrap(opts: ChamberBootstrapOptions): ChamberBootstrap {
  const { displayName, manifest, app, env, runMigrations, closeDb, beforeListen, getSubscriptions } = opts;

  runMigrations();
  beforeListen?.();

  const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
    console.log(`${displayName} listening on http://${info.address}:${info.port}`);
  });

  const { registerWithCapitolUntilSuccess, startHeartbeat, stopHeartbeat, heartbeatNow, deregisterFromCapitol } =
    createCapitolRegistration({
      manifest,
      capitolUrl: env.CAPITOL_URL,
      internalToken: env.CONGRESS_INTERNAL_TOKEN,
      heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
      getSubscriptions,
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

  return { heartbeatNow };
}
