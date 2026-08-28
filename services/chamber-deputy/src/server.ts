import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createDirectiveRequestSchema, updateDirectiveRequestSchema, updateSettingsRequestSchema, postChatMessageRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
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
import { getSettings, updateSettings } from "./settings.js";
import { searchDirectiveExhibits, resolveDirectiveExhibits } from "./exhibits.js";
import { listMessages, postChatMessage, clearThread } from "./chat.js";
import { todaySpendUsd } from "./spend.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import { rearmScheduler } from "./checkup.js";
import { getRunningDirectiveId, withRunningDirective } from "./runningState.js";
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

// Polled by the directives list (not the single-directive page) to drive
// its play-button progress ring's "running" state - see runningState.ts.
app.get("/api/directives/running", async (c) => {
  return c.json({ directiveId: getRunningDirectiveId() });
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

// Play button (list row or directive page) - runs this one directive right
// now, outside its normal schedule. Blocking on the queued run itself, same
// "acceptable for a functional/transactional exchange" call chat.ts already
// makes (concurrency-1 job queue, so this queues behind anything already
// running).
app.post("/api/directives/:id/run", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const directive = await getDirective(id);
  if (!directive) return c.json({ error: "not_found" }, 404);

  await markDirectiveRunNow(id);
  rearmScheduler();
  try {
    const result = await enqueue(() => withRunningDirective(id, () => runDeputy({ trigger: "manual", directive })));
    return c.json({ ok: result.ok, response: result.response, errorMessage: result.errorMessage });
  } catch (err) {
    // runDeputy can throw before ever reaching the CLI (e.g. it couldn't
    // reach Congress to build the MCP config) - report that the same way as
    // every other failure this endpoint can return (paused, budget cap,
    // the CLI itself failing): a 200 with ok:false, so parseJsonResponse
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

// The Clear button (ChatPage, shown in place of Send when the input is
// empty) - Deputy keeps no history beyond the current thread.
app.delete("/api/chat/messages", async (c) => {
  clearThread();
  return c.body(null, 204);
});

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
