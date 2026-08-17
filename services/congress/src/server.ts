import { Hono } from "hono";
import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { z } from "zod";
import { mountManifestAndHealth, mountStaticFrontend } from "@congress/chamber-kit";
import {
  manifestSchema,
  exhibitSyncRequestSchema,
  updateShareRequestSchema,
  updateCapitolSettingsRequestSchema,
  eventPublishRequestSchema,
} from "@congress/shared-types";
import { env } from "./env.js";
import { requireInternalToken, requireSessionOrInternalToken } from "./auth.js";
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
import { forwardToChamber, forwardToChamberFrontend, proxyToChamberIcon, proxyToChamberPath } from "./gateway.js";
import { hasValidSession } from "./sessionAuth.js";
import {
  syncExhibit,
  searchExhibits,
  resolveExhibits,
  resolveOneLive,
  getBacklinks,
  getFrontlinks,
  getCachedChamber,
} from "./exhibits.js";
import { createShare, createShareRequestSchema, listShares, listSharesForExhibit, updateShare, revokeShare, getExhibitSharing } from "./shares.js";
import { requireShareToken, type ShareVariables } from "./shareAuth.js";
import { getSettings, updateSettings } from "./settings.js";
import { publishEvent, listEventsSince, pruneOldEvents } from "./events.js";
import { mcpApp } from "./mcp/server.js";

// Only Capitol itself validates register/deregister/heartbeat/exhibit-resolve
// requests - no Chamber ever needs these shapes, so they live here rather
// than in the shared-types barrel every service imports.
const registerRequestSchema = manifestSchema;
const deregisterRequestSchema = z.object({ name: z.string().min(1) });
const heartbeatRequestSchema = z.object({ name: z.string().min(1) });
// Chamber included per-ref since an id that never synced has no cache row to
// infer the owning chamber from.
const capitolExhibitResolveRequestSchema = z.object({
  refs: z.array(z.object({ id: z.string(), chamber: z.string() })),
});

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, capitolManifest);

app.route("/auth", authRoutes);

app.get("/congress/registry", requireSessionOrInternalToken, (c) => c.json(listChambers()));

// Public/unauthenticated - see proxyToChamberIcon's own comment for why.
app.get("/congress/chambers/:name/icon", (c) => proxyToChamberIcon(c, c.req.param("name")));

app.get("/congress/settings", requireSession, async (c) => c.json(await getSettings()));

app.put("/congress/settings", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateCapitolSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json(await updateSettings(parsed.data));
});

app.post("/congress/register", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_manifest", issues: parsed.error.flatten() }, 400);
  }
  const entry = registerChamber(parsed.data);
  return c.json(entry, 201);
});

app.post("/congress/deregister", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = deregisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const entry = deregisterChamber(parsed.data.name);
  if (!entry) return c.json({ error: "chamber_not_found" }, 404);
  return c.json(entry, 200);
});

app.post("/congress/heartbeat", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = heartbeatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const entry = recordHeartbeat(parsed.data.name);
  if (!entry) return c.json({ error: "chamber_not_found" }, 404);
  return c.json(entry, 200);
});

app.post("/congress/exhibits/sync", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = exhibitSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  syncExhibit(parsed.data);
  return c.json({ ok: true });
});

// Generic event log - Congress only ever appends and returns entries here,
// never inspecting `type`/`payload` or relaying to a chamber by name. See
// events.ts's own comment; a Chamber wanting to react to events (today,
// only the notifications Chamber) polls the GET route on its own schedule.
app.post("/congress/events/publish", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = eventPublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  publishEvent(parsed.data);
  return c.json({ ok: true });
});

app.get("/congress/events", requireInternalToken, (c) => {
  const since = Number(c.req.query("since") ?? "0");
  if (!Number.isInteger(since) || since < 0) {
    return c.json({ error: "invalid_since" }, 400);
  }
  return c.json(listEventsSince(since));
});

// An empty query is meaningful here - it asks each Chamber for its most
// recent Exhibits, which is what the "[[" picker shows before anything has
// been typed.
app.get("/congress/exhibits/search", requireSession, async (c) => {
  const results = await searchExhibits(c.req.query("q") ?? "");
  return c.json({ results });
});

app.post("/congress/exhibits/resolve", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = capitolExhibitResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const results = await resolveExhibits(parsed.data.refs);
  return c.json({ results });
});

app.get("/congress/exhibits/:id/backlinks", requireSession, async (c) => {
  const backlinks = await getBacklinks(c.req.param("id"));
  return c.json({ backlinks });
});

app.get("/congress/exhibits/:id/frontlinks", requireSession, async (c) => {
  const frontlinks = await getFrontlinks(c.req.param("id"));
  return c.json({ frontlinks });
});

// Lets a References panel add/remove a reference that lives on a *different*
// Exhibit than the one currently being viewed (e.g. adding this note to
// another exhibit's outgoing refs from this note's own "Referenced by"
// panel) - resolves which Chamber owns `:id` from the cache and proxies to
// that Chamber's own "/api/exhibits/:id/refs" (see mountManualRefsRoutes in
// @congress/chamber-kit). 404s if the target Chamber hasn't adopted that
// route yet, or if `:id` has never synced to Capitol at all.
app.post("/congress/exhibits/:id/refs", requireSession, async (c) => {
  const id = c.req.param("id");
  // `:id` itself can be uncached too (adding a reference from a
  // never-touched Exhibit's own "Referenced by" panel - e.g. a pre-existing
  // Google Calendar event) - the frontend passes the Chamber it already
  // knows from the search result as a fallback routing hint, since a cache
  // lookup alone would have nothing to go on and 404 before ever reaching
  // the target Chamber. See addExhibitRef's own comment on `sourceChamber`.
  const chamber = getCachedChamber(id) ?? c.req.query("chamber") ?? null;
  if (!chamber) return c.json({ error: "not_found" }, 404);

  // Best-effort eager cache of the target, using the clone so the body
  // stream proxyToChamberPath forwards below is untouched - see
  // manualRefRequestSchema's own comment on `targetChamber` for why this
  // matters: without it, a ref pointing at something never created/edited
  // within Congress (e.g. a pre-existing Google Calendar event) saves fine
  // but never shows up in either panel, since getFrontlinks/getBacklinks
  // silently skip an uncached target.
  try {
    const body: unknown = await c.req.raw.clone().json();
    const targetExhibitId = (body as { targetExhibitId?: unknown })?.targetExhibitId;
    const targetChamber = (body as { targetChamber?: unknown })?.targetChamber;
    if (typeof targetExhibitId === "string" && typeof targetChamber === "string") {
      await resolveOneLive(targetExhibitId, targetChamber);
    }
  } catch {
    // Malformed body - the owning Chamber's own parse (after proxying)
    // is what should surface a 400 for this request, not this step.
  }

  return proxyToChamberPath(c, chamber, `/exhibits/${encodeURIComponent(id)}/refs`);
});

app.delete("/congress/exhibits/:id/refs/:targetExhibitId", requireSession, async (c) => {
  const id = c.req.param("id");
  const chamber = getCachedChamber(id);
  if (!chamber) return c.json({ error: "not_found" }, 404);
  const targetExhibitId = encodeURIComponent(c.req.param("targetExhibitId"));
  return proxyToChamberPath(c, chamber, `/exhibits/${encodeURIComponent(id)}/refs/${targetExhibitId}`);
});

app.get("/congress/exhibits/:id/sharing", requireSession, async (c) => {
  const shares = await getExhibitSharing(c.req.param("id"));
  return c.json({ shares });
});

app.get("/congress/exhibits/:id/shares", requireSession, async (c) => {
  return c.json({ shares: await listSharesForExhibit(c.req.param("id")) });
});

app.post("/congress/shares", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createShareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json(createShare(parsed.data), 201);
});

app.get("/congress/shares", requireSession, (c) => c.json({ shares: listShares() }));

app.patch("/congress/shares/:token", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateShareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const updated = updateShare(c.req.param("token"), parsed.data);
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json(updated);
});

app.delete("/congress/shares/:token", requireSession, (c) => {
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

app.route("/congress/shared", sharedApp);

app.all("/api/:chamber/*", requireSession, forwardToChamber);

// /mcp is called by MCP clients (Claude Code), not the browser - gated by
// the same shared-secret header Chambers use to register/heartbeat, baked
// into createMcpApp itself (chamber-kit) rather than an extra middleware
// layer here, same as every other Chamber's own /mcp mount.
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

mountStaticFrontend(app);

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

// Short on purpose: retention is per-event and can be as low as a few
// minutes (see events.ts's DEFAULT_RETENTION_MS/manifestEventSchema), so an
// hourly sweep would let short-retention rows sit for up to an hour past
// their own expiresAt before actually disappearing.
const EVENT_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

let eventPruneInterval: ReturnType<typeof setInterval> | undefined;

export function startEventPruneSweep() {
  eventPruneInterval = setInterval(() => {
    pruneOldEvents();
  }, EVENT_PRUNE_INTERVAL_MS);
}

export function stopEventPruneSweep() {
  if (eventPruneInterval) clearInterval(eventPruneInterval);
}
