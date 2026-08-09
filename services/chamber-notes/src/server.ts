import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  createNoteRequestSchema,
  updateNoteRequestSchema,
  exhibitResolveRequestSchema,
} from "@congress/shared-types";
import { notesManifest } from "./manifest.js";
import {
  listNotes,
  listPinnedNotes,
  searchNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  TitleConflictError,
} from "./notes.js";
import { searchNoteExhibits, resolveNoteExhibits } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

app.get("/manifest", (c) => c.json(notesManifest));
app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/notes/pinned", async (c) => {
  return c.json(await listPinnedNotes());
});

app.get("/api/notes/search", async (c) => {
  const query = c.req.query("q") ?? "";
  if (!query.trim()) return c.json([]);
  return c.json(await searchNotes(query));
});

app.get("/api/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const note = await getNote(id);
  if (!note) return c.json({ error: "not_found" }, 404);
  return c.json(note);
});

app.get("/api/notes", async (c) => {
  return c.json(await listNotes());
});

app.post("/api/notes", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createNoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  try {
    const note = await createNote(parsed.data);
    return c.json(note, 201);
  } catch (err) {
    if (err instanceof TitleConflictError) {
      return c.json({ error: "title_conflict", message: err.message }, 409);
    }
    throw err;
  }
});

app.put("/api/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateNoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  try {
    const note = await updateNote(id, parsed.data);
    if (!note) return c.json({ error: "not_found" }, 404);
    return c.json(note);
  } catch (err) {
    if (err instanceof TitleConflictError) {
      return c.json({ error: "title_conflict", message: err.message }, 409);
    }
    throw err;
  }
});

app.delete("/api/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteNote(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

app.get("/api/exhibits/search", async (c) => {
  const query = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit")) || undefined;
  if (!query.trim()) return c.json({ results: [] });
  return c.json({ results: await searchNoteExhibits(query, limit) });
});

app.post("/api/exhibits/resolve", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = exhibitResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json({ results: await resolveNoteExhibits(parsed.data.ids) });
});

app.route("/mcp", mcpApp);

app.use(
  "/*",
  serveStatic({
    root: "./frontend/dist",
  })
);
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));
