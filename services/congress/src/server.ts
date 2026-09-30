import { readFileSync } from "node:fs";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { z } from "zod";
import { createMcpApp } from "./kit/mcp.js";
import { mountManifestAndHealth, mountStaticFrontend } from "./kit/static.js";
import {
  updateEventSettingsRequestSchema,
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
  updateCapitolSettingsRequestSchema,
  manualRefRequestSchema,
} from "@congress/shared-types";
import { env } from "./env.js";
import { authRoutes, requireSession } from "./sessionAuth.js";
import { capitolManifest } from "./manifest.js";
import { serveChamberIcon } from "./gateway.js";
import {
  searchExhibits,
  resolveExhibits,
  getConnections,
  addManualConnection,
  removeManualConnection,
} from "./exhibits.js";
import { getSettings, updateSettings } from "./settings.js";
import { publishEvent } from "./events.js";
import { listEventSettings, getEventSettingsByType, updateEventSettings } from "./eventSettings.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { listHistory } from "./eventHistory.js";
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification } from "./notifications.js";
import { publicKey, saveSubscription, removeSubscription } from "./pushSubscriptions.js";
import { mcpApp } from "./mcp/server.js";
import { parseRunContext, withRunContext } from "./ai/runContext.js";
import { aiRoutes } from "./ai/routes.js";
import { getFeed } from "./feed.js";
import { googleConnectorRoutes } from "./connectors/google/routes.js";
import { callHook, connectorRoutes } from "./connectors/routes.js";
import { typeRoutes } from "./typeEngine/routes.js";
import { registerTypeTools } from "./typeEngine/mcpTools.js";
import { registerBuilderTools } from "./mcp/builderTools.js";

// Chamber included per-ref since an id that never synced has no cache row to
// infer the owning chamber from.
const capitolExhibitResolveRequestSchema = z.object({
  refs: z.array(z.object({ id: z.string(), chamber: z.string() })),
});

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, capitolManifest);

app.route("/auth", authRoutes);

// No Chambers remain; the shell still asks (removed with its last caller).
app.get("/congress/registry", requireSession, (c) => c.json([]));

// Public/unauthenticated - see serveChamberIcon's own comment for why.
app.get("/congress/chambers/:name/icon", (c) => serveChamberIcon(c, c.req.param("name")));

app.get("/congress/settings", requireSession, async (c) => c.json(await getSettings()));

app.put("/congress/settings", requireSession, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateCapitolSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json(await updateSettings(parsed.data));
});

// The home "For You" feed: every source's scored views and records, merged and ranked. See feed.ts.
app.get("/congress/feed", requireSession, async (c) => c.json({ items: await getFeed() }));

// Congress's own AI: the chat, the shared budget/pause settings and the
// live run stream - see ai/routes.ts.
app.route("/congress/ai", aiRoutes);

// Google sign-in shared by every connector that talks to Google.
app.route("/congress/connectors/google", googleConnectorRoutes);
app.route("/congress/connectors", connectorRoutes);

// Runtime exhibit types and their records (typeEngine/).
app.route("/congress", typeRoutes);

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

// The browser itself is the publisher here, not another Chamber - the PWA
// shell's own service-worker controllerchange handler (main.tsx) calls this
// right before it force-reloads onto a newly-activated version.
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
// (`targetExhibitId`). Shares its logic with the create_exhibit_connection MCP tool via
// addManualConnection.
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

// The owner's Health Auto Export Shortcut still posts here (the retired
// Fitness Chamber's URL): the health connector's webhook checks its token.
app.post("/api/fitness/health/ingest", (c) => callHook("health", "/ingest", c.req.raw));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// /mcp, /mcp/types and /mcp/builder are called by MCP clients (the `claude` CLI), not
// the browser - gated by the internal-token header inside createMcpApp.
app.use("/mcp", (c, next) => withRunContext(parseRunContext((h) => c.req.header(h)), next));
app.use("/mcp/*", (c, next) => withRunContext(parseRunContext((h) => c.req.header(h)), next));

// Runtime exhibit types' tools (typeEngine/mcpTools.ts), rebuilt per request.
const typesMcpApp = createMcpApp("types", registerTypeTools, env.CONGRESS_INTERNAL_TOKEN);
app.all("/mcp/types", (c) => typesMcpApp.fetch(c.req.raw, c.env));

// Builder mode's tools (mcp/builderTools.ts), only for granted threads.
const builderMcpApp = createMcpApp("builder", registerBuilderTools, env.CONGRESS_INTERNAL_TOKEN);
app.all("/mcp/builder", (c) => builderMcpApp.fetch(c.req.raw, c.env));

app.route("/mcp", mcpApp);

// Public privacy policy + terms (linked from Google's OAuth consent screen).
const privacyHtml = readFileSync(new URL("./legal/privacy.html", import.meta.url), "utf8");
app.get("/privacy", (c) => c.html(privacyHtml));
app.get("/terms", (c) => c.redirect("/privacy#terms"));

mountStaticFrontend(app);
