import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { pushSubscriptionRequestSchema, pushUnsubscribeRequestSchema, priorityLevelSchema } from "@congress/shared-types";
import { createLogRuleRequestSchema, updateLogRuleRequestSchema, updateSettingsRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import {
  listLogRules,
  listRecentLogRules,
  searchLogRules,
  getLogRule,
  createLogRule,
  updateLogRule,
  deleteLogRule,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncLogRuleExhibitByExhibitId,
} from "./logRules.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchLogRuleExhibits, resolveLogRuleExhibits } from "./exhibits.js";
import { listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification } from "./notifications.js";
import { publicKey, saveSubscription, removeSubscription } from "./pushSubscriptions.js";
import { listHistory } from "./eventHistory.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/log-rules/recent", async (c) => {
  return c.json(await listRecentLogRules());
});

app.get("/api/log-rules/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchLogRules(query));
});

app.get("/api/log-rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const rule = await getLogRule(id);
  if (!rule) return c.json({ error: "not_found" }, 404);
  return c.json(rule);
});

app.get("/api/log-rules", async (c) => {
  return c.json(await listLogRules());
});

app.post("/api/log-rules", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createLogRuleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const rule = await createLogRule(parsed.data);
  return c.json(rule, 201);
});

app.put("/api/log-rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateLogRuleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const rule = await updateLogRule(id, parsed.data);
  if (!rule) return c.json({ error: "not_found" }, 404);
  return c.json(rule);
});

app.delete("/api/log-rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteLogRule(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

mountExhibitSearchRoutes(app, { search: searchLogRuleExhibits, resolve: resolveLogRuleExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncLogRuleExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

// This Chamber's own durable record of every event a log rule chose to
// keep - see db/schema.ts's eventHistory. `minPriority` set is what backs
// the "urgent-logs" widget's fixed filter; unset is "recent-logs".
app.get("/api/history", (c) => {
  const rawMinPriority = c.req.query("minPriority");
  const minPriority = rawMinPriority ? priorityLevelSchema.safeParse(rawMinPriority).data : undefined;
  const rawRuleId = c.req.query("ruleId");
  const ruleId = rawRuleId && Number.isInteger(Number(rawRuleId)) ? Number(rawRuleId) : undefined;
  const rawLimit = c.req.query("limit");
  const limit = rawLimit && Number.isInteger(Number(rawLimit)) ? Number(rawLimit) : undefined;
  return c.json(listHistory({ minPriority, ruleId, limit }));
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
