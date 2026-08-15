import type { MiddlewareHandler } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  getShareRow,
  isShareActive,
  touchShareAccess,
  computeShareClosure,
  type ShareRow,
  type ShareClosureEntry,
} from "./shares.js";

export type ShareVariables = {
  share: ShareRow;
  closure: ShareClosureEntry[];
};

// Gates the token-scoped /capitol/shared/:token/* routes - deliberately not
// requireSession, since these are meant to be reachable by a recipient with
// no Congress login at all. 404 (not 401/403) on any invalid token, so a
// probe can't distinguish "wrong token" from "never existed" or "revoked".
export const requireShareToken: MiddlewareHandler<{ Bindings: HttpBindings; Variables: ShareVariables }> = async (
  c,
  next
) => {
  const token = c.req.param("token") ?? "";
  const share = getShareRow(token);
  if (!share || !isShareActive(share)) {
    return c.json({ error: "not_found" }, 404);
  }

  const closure = await computeShareClosure(share);
  touchShareAccess(token);

  c.set("share", share);
  c.set("closure", closure);
  await next();
};
