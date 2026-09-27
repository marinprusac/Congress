import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChamberSubscription, EventDelivery, Manifest } from "@congress/shared-types";

// A Chamber as Congress loads it: a module in Congress's own process, not a
// process of its own. Each Chamber's src/module.ts default-exports one.
export interface ChamberModule {
  manifest: Manifest;
  // Serves "/api/*"; Congress dispatches "/api/<name>/*" to it in-process.
  app: Hono<{ Bindings: HttpBindings }>;
  registerTools: (server: McpServer) => void;
  // Absolute path of the Chamber's folder (holds .env, data/, frontend/dist).
  dir: string;
  initEnv: (source: Record<string, string | undefined>) => void;
  // Migrations plus any pollers/timers; stop() undoes both.
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  subscriptions?: () => ChamberSubscription[];
  onEvent?: (event: EventDelivery) => void | Promise<void>;
}

export function defineChamber(module: ChamberModule): ChamberModule {
  return module;
}
