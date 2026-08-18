import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createDirectiveRequestSchema, updateDirectiveRequestSchema, updateSettingsRequestSchema, postChatMessageRequestSchema } from "./types.js";
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
  listDirectives,
  listRecentDirectives,
  searchDirectives,
  getDirective,
  createDirective,
  updateDirective,
  deleteDirective,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncDirectiveExhibitByExhibitId,
} from "./directives.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchDirectiveExhibits, resolveDirectiveExhibits, getDirectiveExhibitContent, updateDirectiveExhibitContent } from "./exhibits.js";
import { listMessages, postChatMessage } from "./chat.js";
import { listRecentRuns, getRun, todaySpendUsd } from "./deputyRuns.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);

app.get("/api/directives/recent", async (c) => {
  return c.json(await listRecentDirectives());
});

app.get("/api/directives/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchDirectives(query));
});

app.get("/api/directives/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const directive = await getDirective(id);
  if (!directive) return c.json({ error: "not_found" }, 404);
  return c.json(directive);
});

app.get("/api/directives", async (c) => {
  return c.json(await listDirectives());
});

app.post("/api/directives", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createDirectiveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const directive = await createDirective(parsed.data);
  return c.json(directive, 201);
});

app.put("/api/directives/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateDirectiveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const directive = await updateDirective(id, parsed.data);
  if (!directive) return c.json({ error: "not_found" }, 404);
  return c.json(directive);
});

app.delete("/api/directives/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteDirective(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

mountExhibitSearchRoutes(app, { search: searchDirectiveExhibits, resolve: resolveDirectiveExhibits });

mountExhibitContentRoutes(app, { getContent: getDirectiveExhibitContent, updateContent: updateDirectiveExhibitContent });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncDirectiveExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateSettingsRequestSchema);

app.get("/api/settings/spend", async (c) => {
  return c.json({ spentTodayUsd: await todaySpendUsd() });
});

// Chat - blocking on the queued headless run itself (see chat.ts/jobQueue.ts:
// concurrency 1, so a message arriving mid-checkup queues behind it), not a
// fire-and-forget + poll shape. Acceptable for a functional/transactional
// exchange rather than a live-streaming one (docs/deputy-chamber-plan.md §1).
app.get("/api/chat/messages", async (c) => {
  return c.json(await listMessages());
});

app.post("/api/chat/messages", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = postChatMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json(await postChatMessage(parsed.data));
});

app.get("/api/runs/recent", async (c) => {
  return c.json(await listRecentRuns());
});

app.get("/api/runs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const run = await getRun(id);
  if (!run) return c.json({ error: "not_found" }, 404);
  return c.json(run);
});

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
