import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  registerRequestSchema,
  deregisterRequestSchema,
  heartbeatRequestSchema,
  exhibitSyncRequestSchema,
  capitolExhibitResolveRequestSchema,
  createShareRequestSchema,
  updateShareRequestSchema,
} from "@congress/shared-types";
import { env } from "./env.js";
import { requireInternalToken } from "./auth.js";
import { authRoutes, requireSession } from "./sessionAuth.js";
import { capitolManifest } from "./manifest.js";
import {
  registerChamber,
  deregisterChamber,
  recordHeartbeat,
  listChambers,
  sweepStaleChambers,
  getChamber,
} from "./registry.js";
import { forwardToChamber, forwardToChamberFrontend, proxyToChamberPath } from "./gateway.js";
import { hasValidSession } from "./sessionAuth.js";
import { syncExhibit, searchExhibits, resolveExhibits, getBacklinks, getFrontlinks } from "./exhibits.js";
import { createShare, listShares, listSharesForRoot, updateShare, revokeShare, getExhibitSharing } from "./shares.js";
import { requireShareToken, type ShareVariables } from "./shareAuth.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

app.get("/manifest", (c) => c.json(capitolManifest));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);

app.get("/capitol/registry", requireSession, (c) => c.json(listChambers()));

app.post("/capitol/register", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_manifest", issues: parsed.error.flatten() }, 400);
  }
  const entry = registerChamber(parsed.data);
  return c.json(entry, 201);
});

app.post("/capitol/deregister", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = deregisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const entry = deregisterChamber(parsed.data.name);
  if (!entry) return c.json({ error: "chamber_not_found" }, 404);
  return c.json(entry, 200);
});

app.post("/capitol/heartbeat", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = heartbeatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const entry = recordHeartbeat(parsed.data.name);
  if (!entry) return c.json({ error: "chamber_not_found" }, 404);
  return c.json(entry, 200);
});

app.post("/capitol/exhibits/sync", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = exhibitSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  syncExhibit(parsed.data);
  return c.json({ ok: true });
});

// An empty query is meaningful here - it asks each Chamber for its most
// recent Exhibits, which is what the "[[" picker shows before anything has
// been typed.
app.get("/capitol/exhibits/search", requireSession, async (c) => {
  const results = await searchExhibits(c.req.query("q") ?? "");
  return c.json({ results });
});

app.post("/capitol/exhibits/resolve", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = capitolExhibitResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const results = await resolveExhibits(parsed.data.refs);
  return c.json({ results });
});

app.get("/capitol/exhibits/:id/backlinks", requireSession, async (c) => {
  const backlinks = await getBacklinks(c.req.param("id"));
  return c.json({ backlinks });
});

app.get("/capitol/exhibits/:id/frontlinks", requireSession, async (c) => {
  const frontlinks = await getFrontlinks(c.req.param("id"));
  return c.json({ frontlinks });
});

app.get("/capitol/exhibits/:id/sharing", requireSession, async (c) => {
  const shares = await getExhibitSharing(c.req.param("id"));
  return c.json({ shares });
});

app.get("/capitol/exhibits/:id/shares", requireSession, (c) => {
  return c.json({ shares: listSharesForRoot(c.req.param("id")) });
});

app.post("/capitol/shares", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createShareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json(createShare(parsed.data), 201);
});

app.get("/capitol/shares", requireSession, (c) => c.json({ shares: listShares() }));

app.patch("/capitol/shares/:token", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateShareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const updated = updateShare(c.req.param("token"), parsed.data);
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json(updated);
});

app.delete("/capitol/shares/:token", requireSession, (c) => {
  if (!revokeShare(c.req.param("token"))) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ ok: true });
});

// Token-scoped access for share recipients - deliberately not gated by
// requireSession, since the whole point is reaching this with no Congress
// login. requireShareToken validates the token and computes the closure
// once per request; every handler below checks the requested id against
// that closure before proxying anywhere.
const sharedApp = new Hono<{ Bindings: HttpBindings; Variables: ShareVariables }>();
sharedApp.use("/:token", requireShareToken);
sharedApp.use("/:token/*", requireShareToken);

sharedApp.get("/:token", (c) => {
  const share = c.get("share");
  return c.json({
    token: share.id,
    rootId: share.rootId,
    rootChamber: share.rootChamber,
    permission: share.permission,
    label: share.label,
    closure: c.get("closure"),
  });
});

sharedApp.post("/:token/exhibits/resolve", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = capitolExhibitResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const closureIds = new Set(c.get("closure").map((e) => e.id));
  const results = await resolveExhibits(parsed.data.refs.filter((r) => closureIds.has(r.id)));
  return c.json({ results });
});

sharedApp.get("/:token/exhibits/:id", async (c) => {
  const id = c.req.param("id");
  const entry = c.get("closure").find((e) => e.id === id);
  if (!entry) return c.json({ error: "not_found" }, 404);
  return proxyToChamberPath(c, entry.chamber, `/exhibits/${encodeURIComponent(id)}/content`);
});

sharedApp.get("/:token/exhibits/:id/download", async (c) => {
  const id = c.req.param("id");
  const entry = c.get("closure").find((e) => e.id === id);
  if (!entry) return c.json({ error: "not_found" }, 404);
  return proxyToChamberPath(c, entry.chamber, `/exhibits/${encodeURIComponent(id)}/content/download`);
});

sharedApp.patch("/:token/exhibits/:id", async (c) => {
  const share = c.get("share");
  if (share.permission !== "edit") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const entry = c.get("closure").find((e) => e.id === id);
  if (!entry) return c.json({ error: "not_found" }, 404);
  return proxyToChamberPath(c, entry.chamber, `/exhibits/${encodeURIComponent(id)}/content`);
});

app.route("/capitol/shared", sharedApp);

app.all("/api/:chamber/*", requireSession, forwardToChamber);

// /mcp is called by MCP clients (Claude Code), not the browser, so it's
// gated by the same shared-secret header Chambers use to register/heartbeat
// rather than the browser session cookie.
app.use("/mcp", requireInternalToken);
app.use("/mcp/*", requireInternalToken);
app.route("/mcp", mcpApp);

// Each Chamber's own frontend is reachable through Capitol at
// "/<chamberName>/*", proxied straight through to that Chamber's process.
// Only intercepts paths whose first segment is an actually-registered
// Chamber name, so it can't shadow Capitol's own static assets or routes.
async function chamberFrontendProxy(c: Context<{ Bindings: HttpBindings }>) {
  const chamberName = c.req.param("chamberName") ?? "";
  const chamber = getChamber(chamberName);
  if (!chamber) return undefined;
  if (!(await hasValidSession(c))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return forwardToChamberFrontend(c, chamber);
}
app.all("/:chamberName", async (c, next) => (await chamberFrontendProxy(c)) ?? next());
app.all("/:chamberName/*", async (c, next) => (await chamberFrontendProxy(c)) ?? next());

app.use(
  "/*",
  serveStatic({
    root: "./frontend/dist",
  })
);
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));

let sweepInterval: ReturnType<typeof setInterval> | undefined;

export function startHeartbeatSweep() {
  sweepInterval = setInterval(() => {
    const stale = sweepStaleChambers(env.HEARTBEAT_TIMEOUT_MS);
    if (stale.length > 0) {
      console.log(`Marked stale Chambers offline: ${stale.join(", ")}`);
    }
  }, env.HEARTBEAT_SWEEP_INTERVAL_MS);
}

export function stopHeartbeatSweep() {
  if (sweepInterval) clearInterval(sweepInterval);
}
