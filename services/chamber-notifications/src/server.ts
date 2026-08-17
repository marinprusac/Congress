import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { pushSubscriptionRequestSchema, pushUnsubscribeRequestSchema } from "@congress/shared-types";
import { createAutomationRequestSchema, updateAutomationRequestSchema, updateSettingsRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountExhibitContentRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import {
  listAutomations,
  listRecentAutomations,
  searchAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncAutomationExhibitByExhibitId,
} from "./automations.js";
import { getSettings, updateSettings } from "./settings.js";
import {
  searchAutomationExhibits,
  resolveAutomationExhibits,
  getAutomationExhibitContent,
  updateAutomationExhibitContent,
} from "./exhibits.js";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
} from "./notifications.js";
import { publicKey, saveSubscription, removeSubscription } from "./pushSubscriptions.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/automations/recent", async (c) => {
  return c.json(await listRecentAutomations());
});

app.get("/api/automations/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchAutomations(query));
});

app.get("/api/automations/:id/runs", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  return c.json(await listAutomationRuns(id));
});

app.get("/api/automations/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const automation = await getAutomation(id);
  if (!automation) return c.json({ error: "not_found" }, 404);
  return c.json(automation);
});

app.get("/api/automations", async (c) => {
  return c.json(await listAutomations());
});

app.post("/api/automations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createAutomationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const automation = await createAutomation(parsed.data);
  return c.json(automation, 201);
});

app.put("/api/automations/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateAutomationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const automation = await updateAutomation(id, parsed.data);
  if (!automation) return c.json({ error: "not_found" }, 404);
  return c.json(automation);
});

app.delete("/api/automations/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteAutomation(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

mountExhibitSearchRoutes(app, { search: searchAutomationExhibits, resolve: resolveAutomationExhibits });

mountExhibitContentRoutes(app, { getContent: getAutomationExhibitContent, updateContent: updateAutomationExhibitContent });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncAutomationExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

// The notification center itself - formerly owned by Congress
// (/congress/notifications/*, /congress/push/*), moved here so Congress has
// no notification-specific product surface left. Reached through Congress's
// existing session-gated /api/:chamber/* gateway proxy, same as any other
// Chamber's own API - no session check needed here.
app.get("/api/notifications", (c) => c.json(listNotifications()));

app.post("/api/notifications/read-all", (c) => {
  markAllNotificationsRead();
  return c.json({ ok: true });
});

app.post("/api/notifications/:id/read", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || !markNotificationRead(id)) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/notifications/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || !dismissNotification(id)) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/push/config", (c) => c.json({ publicKey: publicKey() }));

app.post("/api/push/subscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushSubscriptionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  saveSubscription(parsed.data);
  return c.json({ ok: true });
});

app.post("/api/push/unsubscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushUnsubscribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  removeSubscription(parsed.data.endpoint);
  return c.json({ ok: true });
});

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
