import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { pushSubscriptionRequestSchema, pushUnsubscribeRequestSchema } from "@congress/shared-types";
import { updateEventSettingsRequestSchema, updateSettingsRequestSchema } from "./types.js";
import { mountManifestAndHealth, mountSettingsRoutes, mountStaticFrontend, mountEventReceiveRoute } from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import { env } from "./env.js";
import { handleReceivedEvent } from "./eventReceive.js";
import { listEventSettings, getEventSettingsByType, updateEventSettings } from "./eventSettings.js";
import { syncEventCatalog } from "./eventCatalogSync.js";
import { getSettings, updateSettings } from "./settings.js";
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification } from "./notifications.js";
import { publicKey, saveSubscription, removeSubscription } from "./pushSubscriptions.js";
import { listHistory } from "./eventHistory.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);
mountEventReceiveRoute(app, env.CONGRESS_INTERNAL_TOKEN, handleReceivedEvent);

// One row per known event type, auto-derived from the live Chamber
// registry - no create/delete route exists, see eventSettings.ts. Synced
// before listing so the page is current the moment it's opened, not just
// on the next periodic sweep (eventCatalogSync.ts).
app.get("/api/event-settings", async (c) => {
  await syncEventCatalog();
  return c.json(await listEventSettings());
});

app.get("/api/event-settings/:eventType", async (c) => {
  const eventType = c.req.param("eventType");
  const row = await getEventSettingsByType(eventType);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

app.put("/api/event-settings/:eventType", async (c) => {
  const eventType = c.req.param("eventType");
  const body = await c.req.json().catch(() => null);
  const parsed = updateEventSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const row = await updateEventSettings(eventType, parsed.data);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

// This Chamber's own durable record of every event an event type's settings
// chose to keep - see db/schema.ts's eventHistory. Backs the "recent-logs"
// widget.
app.get("/api/history", (c) => {
  const eventType = c.req.query("eventType") ?? undefined;
  const rawLimit = c.req.query("limit");
  const limit = rawLimit && Number.isInteger(Number(rawLimit)) ? Number(rawLimit) : undefined;
  return c.json(listHistory({ eventType, limit }));
});

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
