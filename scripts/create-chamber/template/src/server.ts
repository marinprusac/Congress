import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createItemRequestSchema, updateItemRequestSchema, updateSettingsRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import {
  listItems,
  listRecentItems,
  searchItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncItemExhibitByExhibitId,
} from "./items.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchItemExhibits, resolveItemExhibits } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/items/recent", async (c) => {
  return c.json(await listRecentItems());
});

app.get("/api/items/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchItems(query));
});

app.get("/api/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const item = await getItem(id);
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

app.get("/api/items", async (c) => {
  return c.json(await listItems());
});

app.post("/api/items", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const item = await createItem(parsed.data);
  return c.json(item, 201);
});

app.put("/api/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const item = await updateItem(id, parsed.data);
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json(item);
});

app.delete("/api/items/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteItem(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

mountExhibitSearchRoutes(app, { search: searchItemExhibits, resolve: resolveItemExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncItemExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
