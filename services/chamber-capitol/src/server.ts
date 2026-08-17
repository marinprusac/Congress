import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { mountManifestAndHealth, mountStaticFrontend } from "@congress/chamber-kit";
import { canvasScopeSchema, upsertPlacementRequestSchema } from "./types.js";
import { manifest } from "./manifest.js";
import { listPlacements, upsertPlacement, deletePlacement } from "./layout.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/layout/:scope", (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  return c.json(listPlacements(scope.data));
});

app.put("/api/layout/:scope/:chamber/:widgetId", async (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPlacementRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);

  const placement = upsertPlacement(scope.data, c.req.param("chamber"), c.req.param("widgetId"), parsed.data.x, parsed.data.y);
  if (!placement) return c.json({ error: "cell_occupied" }, 409);
  return c.json(placement);
});

app.delete("/api/layout/:scope/:chamber/:widgetId", (c) => {
  const scope = canvasScopeSchema.safeParse(c.req.param("scope"));
  if (!scope.success) return c.json({ error: "invalid_scope" }, 400);
  deletePlacement(scope.data, c.req.param("chamber"), c.req.param("widgetId"));
  return c.body(null, 204);
});

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
