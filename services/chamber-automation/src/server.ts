import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
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
import { searchAutomationExhibits, resolveAutomationExhibits, getAutomationExhibitContent, updateAutomationExhibitContent } from "./exhibits.js";
import { listToolsForChamber } from "./remoteTools.js";
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

// The action editor's own live chamber+tool picker - see remoteTools.ts.
app.get("/api/chambers/:chamber/tools", async (c) => {
  const chamber = c.req.param("chamber");
  try {
    const tools = await listToolsForChamber(chamber);
    if (tools === null) return c.json({ error: "chamber_unreachable" }, 502);
    return c.json(tools);
  } catch (err) {
    return c.json({ error: "chamber_unreachable", message: (err as Error).message }, 502);
  }
});

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
