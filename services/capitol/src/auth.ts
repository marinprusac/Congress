import type { MiddlewareHandler } from "hono";
import { env } from "./env.js";

export const requireInternalToken: MiddlewareHandler = async (c, next) => {
  const token = c.req.header("X-Congress-Internal-Token");
  if (!token || token !== env.CONGRESS_INTERNAL_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
