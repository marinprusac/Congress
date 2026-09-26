import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createDirectiveRequestSchema, updateDirectiveRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
  mountEventReceiveRoute,
} from "@congress/chamber-kit";
import { manifest } from "./manifest.js";
import { env } from "./env.js";
import { handleReceivedEvent } from "./eventReceive.js";
import {
  listDirectives,
  listRecentDirectives,
  searchDirectives,
  getDirective,
  createDirective,
  updateDirective,
  deleteDirective,
  markDirectiveRunNow,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncDirectiveExhibitByExhibitId,
} from "./directives.js";
import { searchDirectiveExhibits, resolveDirectiveExhibits } from "./exhibits.js";
import { runDirective } from "./engine.js";
import { rearmScheduler } from "./checkup.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, manifest);
mountEventReceiveRoute(app, env.CONGRESS_INTERNAL_TOKEN, handleReceivedEvent);

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
  rearmScheduler();
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
  rearmScheduler();
  return c.json(directive);
});

app.delete("/api/directives/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteDirective(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  rearmScheduler();
  return c.body(null, 204);
});

// Play button (directive page) - runs this one directive right now, outside
// its normal schedule. Blocks on the run itself, which Congress queues
// behind anything already running (its AI job queue is concurrency-1).
app.post("/api/directives/:id/run", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const directive = await getDirective(id);
  if (!directive) return c.json({ error: "not_found" }, 404);

  await markDirectiveRunNow(id);
  rearmScheduler();
  try {
    const result = await runDirective({ trigger: "manual", directive });
    return c.json({ ok: result.ok, response: result.response, errorMessage: result.errorMessage });
  } catch (err) {
    // runDirective throws when Congress itself couldn't be reached - report
    // that the same way as every other failure this endpoint can return
    // (paused, budget cap, the CLI itself failing): a 200 with ok:false, so parseJsonResponse
    // (congress-ui) doesn't throw away this body and swallow errorMessage
    // behind a generic "Request failed: <status>".
    return c.json({ ok: false, response: null, errorMessage: (err as Error).message });
  }
});

mountExhibitSearchRoutes(app, { search: searchDirectiveExhibits, resolve: resolveDirectiveExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncDirectiveExhibitByExhibitId
);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
