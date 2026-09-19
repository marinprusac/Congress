import { Hono } from "hono";
import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { z } from "zod";
import { mountManifestAndHealth, mountStaticFrontend } from "@congress/chamber-kit";
import {
  canvasScopeSchema,
  upsertPlacementRequestSchema,
  updateEventSettingsRequestSchema,
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
  manifestSchema,
  exhibitSyncRequestSchema,
  updateCapitolSettingsRequestSchema,
  eventPublishRequestSchema,
  chamberSubscriptionSchema,
  manualRefRequestSchema,
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
  getConnections,
  addManualConnection,
  removeManualConnection,
} from "./exhibits.js";
import { getSettings, updateSettings } from "./settings.js";
import { publishEvent } from "./events.js";
import { listPlacements, upsertPlacement, deletePlacement } from "./layout.js";
import { listEventSettings, getEventSettingsByType, updateEventSettings } from "./eventSettings.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { listHistory } from "./eventHistory.js";
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification } from "./notifications.js";
import { publicKey, saveSubscription, removeSubscription } from "./pushSubscriptions.js";
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

// Homepage canvas layout - where each registered widget sits per viewport
// class. See layout.ts / db/schema.ts's widgetLayouts.
app.get("/congress/layout/:scope", requireSession, (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  return c.json(listPlacements(scope.data));
});

app.put("/congress/layout/:scope/:chamber/:widgetId", requireSession, async (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPlacementRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);

  const placement = upsertPlacement(scope.data, c.req.param("chamber"), c.req.param("widgetId"), parsed.data.x, parsed.data.y);
  if (!placement) return c.json({ error: "cell_occupied" }, 409);
  return c.json(placement);
});

app.delete("/congress/layout/:scope/:chamber/:widgetId", requireSession, (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  deletePlacement(scope.data, c.req.param("chamber"), c.req.param("widgetId"));
  return c.body(null, 204);
});

// One row per known event type, auto-derived from the live registry - no
// create/delete route exists, see eventSettings.ts. Synced before listing so
// the page is current the moment it's opened, not just on the next sweep.
app.get("/congress/event-settings", requireSession, async (c) => {
  syncEventCatalog();
  return c.json(await listEventSettings());
});

app.get("/congress/event-settings/:eventType", requireSession, async (c) => {
  const row = await getEventSettingsByType(c.req.param("eventType"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

app.put("/congress/event-settings/:eventType", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateEventSettingsRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  const row = await updateEventSettings(c.req.param("eventType"), parsed.data);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

app.get("/congress/history", requireSession, (c) => {
  const rawLimit = c.req.query("limit");
  const limit = rawLimit && Number.isInteger(Number(rawLimit)) ? Number(rawLimit) : undefined;
  return c.json(listHistory({ eventType: c.req.query("eventType") ?? undefined, actor: c.req.query("actor") ?? undefined, limit }));
});

// The owner's notification inbox + Web Push subscriptions.
app.get("/congress/notifications", requireSession, (c) => c.json(listNotifications()));

app.post("/congress/notifications/read-all", requireSession, (c) => {
  markAllNotificationsRead();
  return c.json({ ok: true });
});

app.post("/congress/notifications/:id/read", requireSession, (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || !markNotificationRead(id)) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.delete("/congress/notifications/:id", requireSession, (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || !dismissNotification(id)) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/congress/push/config", requireSession, (c) => c.json({ publicKey: publicKey() }));

app.post("/congress/push/subscribe", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushSubscriptionRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  saveSubscription(parsed.data);
  return c.json({ ok: true });
});

app.post("/congress/push/unsubscribe", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushUnsubscribeRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  removeSubscription(parsed.data.endpoint);
  return c.json({ ok: true });
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

// The browser itself is the publisher here, not another Chamber - the PWA
// shell's own service-worker controllerchange handler (main.tsx) calls this
// right before it force-reloads onto a newly-activated version. Session-
// gated rather than internal-token-gated for that reason (see
// requireSessionOrInternalToken's own comment on the same distinction for
// /congress/registry).
app.post("/congress/events/app-updated", requireSession, async (c) => {
  publishEvent({ chamber: "congress", type: "congress.app_updated", payload: {} });
  return c.json({ ok: true });
});

// An empty query is meaningful here - it asks each Chamber for its most
// recent Exhibits, which is what the "[[" picker shows before anything has
// been typed.
app.get("/congress/exhibits/search", requireSession, async (c) => {
  const results = await searchExhibits(c.req.query("q") ?? "");
  return c.json({ results });
});

// requireSessionOrInternalToken (not requireSession) - a Chamber's own
// backend resolves exhibit tokens too now (e.g. chamber-calendar projecting
// a rich value's tokens to plain labels before syncing to Google), and it
// has no session cookie to present, only the shared internal token.
app.post("/congress/exhibits/resolve", requireSessionOrInternalToken, async (c) => {
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
// Shares its logic with the create_exhibit_connection MCP tool via
// addManualConnection, since an MCP tool handler has no Hono Context to hand
// proxyToChamberPath (which this route used to call directly).
app.post("/congress/exhibits/:id/connections", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = manualRefRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const result = await addManualConnection(c.req.param("id"), parsed.data.targetExhibitId, parsed.data.targetChamber);
  if ("error" in result) return c.json(result, 404);
  return c.json(result);
});

// Removes a manual connection between `:id` (the Exhibit currently being
// viewed) and `:otherExhibitId`, regardless of which of the two the
// underlying row happens to be stored on - see getManualConnectionOwner.
// Shares its logic with the delete_exhibit_connection MCP tool via
// removeManualConnection, same reasoning as the POST route above.
app.delete("/congress/exhibits/:id/connections/:otherExhibitId", requireSession, async (c) => {
  const result = await removeManualConnection(c.req.param("id"), c.req.param("otherExhibitId"));
  if ("error" in result) return c.json(result, 404);
  return c.json(result);
});

// Reachable at /api/fitness/health/ingest, forwarded through
// unauthenticated by Congress itself - unlike every other "/api/:chamber/*"
// request, this one is called by an iOS Shortcuts automation, which cannot
// present a session cookie. The secret check happens entirely inside
// chamber-fitness's own route handler (src/health/ingest.ts), comparing a
// caller-supplied header against that Chamber's own settings row - safe
// because chamber-fitness itself is only reachable through this forward
// (only Congress is publicly exposed; every Chamber binds 127.0.0.1).
// Registered ahead of the generic "/api/:chamber/*" wildcard below (Hono
// matches route registration order), exactly like every /congress/* route
// already is. No dedicated auth middleware here on purpose - Congress
// asserts nothing about the caller for this one path, so a middleware whose
// only job would be to call next() is pure ceremony.
app.post("/api/fitness/health/ingest", (c) => proxyToChamberPath(c, "fitness", "/health/ingest", "system"));

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
