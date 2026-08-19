import { Hono } from "hono";
import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { z } from "zod";
import { mountManifestAndHealth, mountStaticFrontend } from "@congress/chamber-kit";
import {
  manifestSchema,
  exhibitSyncRequestSchema,
  updateCapitolSettingsRequestSchema,
  eventPublishRequestSchema,
  chamberSubscriptionSchema,
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
  getConnections,
  getCachedChamber,
  getManualConnectionOwner,
} from "./exhibits.js";
import { getSettings, updateSettings } from "./settings.js";
import { publishEvent } from "./events.js";
import { mcpApp } from "./mcp/server.js";

// Only Capitol itself validates register/deregister/heartbeat/exhibit-resolve
// requests - no Chamber ever needs these shapes, so they live here rather
// than in the shared-types barrel every service imports. `subscriptions` on
// both register and heartbeat is this Chamber's own dynamic event interest
// list (see shared-types/events.ts's chamberSubscriptionSchema) - defaulted
// so a Chamber that never subscribes to anything doesn't have to think
// about this field.
const registerRequestSchema = manifestSchema.extend({
  subscriptions: z.array(chamberSubscriptionSchema).default([]),
});
const deregisterRequestSchema = z.object({ name: z.string().min(1) });
const heartbeatRequestSchema = z.object({
  name: z.string().min(1),
  subscriptions: z.array(chamberSubscriptionSchema).default([]),
});
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
  const entry = registerChamber(parsed.data, parsed.data.subscriptions);
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
  const entry = recordHeartbeat(parsed.data.name, parsed.data.subscriptions);
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

// Push-relays a domain event to every currently-active, currently-
// subscribed Chamber instead of storing it - see events.ts's own comment.
// Not awaited: publishEvent kicks off each interested Chamber's own
// background delivery/retry and returns immediately, so a slow or
// temporarily-unreachable subscriber never makes the publishing Chamber's
// own request hang.
app.post("/congress/events/publish", requireInternalToken, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = eventPublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  publishEvent(parsed.data);
  return c.json({ ok: true });
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

app.get("/congress/exhibits/:id/connections", requireSession, async (c) => {
  const connections = await getConnections(c.req.param("id"));
  return c.json({ connections });
});

// Adds a manual connection from the Exhibit currently being viewed (`:id`,
// always already-cached - it's the record on screen) to a picked Exhibit
// (`targetExhibitId`) - proxies to `:id`'s own Chamber's
// "/api/exhibits/:id/refs" (see mountManualRefsRoutes in @congress/chamber-kit).
app.post("/congress/exhibits/:id/connections", requireSession, async (c) => {
  const id = c.req.param("id");
  const chamber = getCachedChamber(id);
  if (!chamber) return c.json({ error: "not_found" }, 404);

  // Best-effort eager cache of the target, using the clone so the body
  // stream proxyToChamberPath forwards below is untouched - see
  // manualRefRequestSchema's own comment on `targetChamber` for why this
  // matters: without it, a connection pointing at something never
  // created/edited within Congress (e.g. a pre-existing Google Calendar
  // event) saves fine but never shows up in the panel, since getConnections
  // silently skips an uncached, chamber-unknown target.
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

// Removes a manual connection between `:id` (the Exhibit currently being
// viewed) and `:otherExhibitId`, regardless of which of the two the
// underlying row happens to be stored on - see getManualConnectionOwner.
app.delete("/congress/exhibits/:id/connections/:otherExhibitId", requireSession, async (c) => {
  const id = c.req.param("id");
  const otherExhibitId = c.req.param("otherExhibitId");
  const owner = getManualConnectionOwner(id, otherExhibitId);
  if (!owner) return c.json({ error: "not_found" }, 404);
  const otherId = owner.ownerId === id ? otherExhibitId : id;
  return proxyToChamberPath(
    c,
    owner.chamber,
    `/exhibits/${encodeURIComponent(owner.ownerId)}/refs/${encodeURIComponent(otherId)}`
  );
});

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
