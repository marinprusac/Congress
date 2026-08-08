import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createNoteRequestSchema, updateNoteRequestSchema } from "@congress/shared-types";
import { notesManifest } from "./manifest.js";
import {
  listNotes,
  searchNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  TitleConflictError,
} from "./notes.js";
import { db } from "./db/client.js";
import { notes } from "./db/schema.js";
import { desc } from "drizzle-orm";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

app.get("/manifest", (c) => c.json(notesManifest));
app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/widget", (c) => {
  const total = db.select().from(notes).all().length;
  const recent = db
    .select({ title: notes.title })
    .from(notes)
    .orderBy(desc(notes.updatedAt))
    .limit(5)
    .all();
  return c.json({
    summary: total === 1 ? "1 note" : `${total} notes`,
    items: recent.map((n) => ({ label: n.title })),
  });
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

app.route("/mcp", mcpApp);

app.use(
  "/*",
  serveStatic({
    root: "./frontend/dist",
  })
);
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));
