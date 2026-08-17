import type { MiddlewareHandler } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { env } from "./env.js";
import { hasValidSession } from "./sessionAuth.js";

export const requireInternalToken: MiddlewareHandler = async (c, next) => {
  const token = c.req.header("X-Congress-Internal-Token");
  if (!token || token !== env.CONGRESS_INTERNAL_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

// For routes read by both the browser (session cookie) and a Chamber's own
// backend (e.g. Automation Chamber resolving a target Chamber's mcpUrl out
// of the registry) - accepts either, same shared-secret header as
// register/heartbeat/events for the latter.
export const requireSessionOrInternalToken: MiddlewareHandler<{ Bindings: HttpBindings }> = async (c, next) => {
  const token = c.req.header("X-Congress-Internal-Token");
  if (token && token === env.CONGRESS_INTERNAL_TOKEN) return next();
  if (await hasValidSession(c)) return next();
  return c.json({ error: "unauthorized" }, 401);
};
