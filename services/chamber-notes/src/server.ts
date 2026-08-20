import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createNoteRequestSchema, updateNoteRequestSchema, updateNotesSettingsRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountSettingsRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { notesManifest } from "./manifest.js";
import {
  listNotes,
  listPinnedNotes,
  searchNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncNoteExhibitByExhibitId,
  TitleConflictError,
} from "./notes.js";
import { getSettings, updateSettings } from "./settings.js";
import { searchNoteExhibits, resolveNoteExhibits, chipNoteExhibit } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, notesManifest);

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

mountExhibitSearchRoutes(app, { search: searchNoteExhibits, resolve: resolveNoteExhibits, chip: chipNoteExhibit });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncNoteExhibitByExhibitId
);

mountSettingsRoutes(app, { getSettings, updateSettings }, updateNotesSettingsRequestSchema);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
