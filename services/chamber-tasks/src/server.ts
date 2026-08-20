import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createTaskRequestSchema, updateTaskRequestSchema, updateTasksSettingsRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { tasksManifest } from "./manifest.js";
import {
  listTasks,
  listOpenTasks,
  searchTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncTaskExhibitByExhibitId,
} from "./tasks.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchTaskExhibits, resolveTaskExhibits, chipTaskExhibit } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, tasksManifest);

app.get("/api/tasks/open", async (c) => {
  return c.json(await listOpenTasks());
});

app.get("/api/tasks/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchTasks(query));
});

app.get("/api/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const task = await getTask(id);
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json(task);
});

app.get("/api/tasks", async (c) => {
  return c.json(await listTasks());
});

app.post("/api/tasks", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const task = await createTask(parsed.data);
  return c.json(task, 201);
});

app.put("/api/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const task = await updateTask(id, parsed.data);
  if (!task) return c.json({ error: "not_found" }, 404);
  return c.json(task);
});

app.delete("/api/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteTask(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

mountExhibitSearchRoutes(app, { search: searchTaskExhibits, resolve: resolveTaskExhibits, chip: chipTaskExhibit });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncTaskExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateTasksSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
