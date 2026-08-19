import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { updateDocumentRequestSchema } from "./types.js";
import {
  mountManifestAndHealth,
  mountExhibitSearchRoutes,
  mountManualRefsRoutes,
  mountStaticFrontend,
} from "@congress/chamber-kit";
import { documentsManifest } from "./manifest.js";
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentFile,
  FileTooLargeError,
  MAX_FILE_SIZE_BYTES,
  listManualRefsByExhibitId,
  addManualRefByExhibitId,
  removeManualRefByExhibitId,
  resyncDocumentExhibitByExhibitId,
} from "./documents.js";
import { searchDocumentExhibits, resolveDocumentExhibits } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

mountManifestAndHealth(app, documentsManifest);

app.get("/api/documents", async (c) => {
  return c.json(await listDocuments());
});

app.post("/api/documents", async (c) => {
  const body = await c.req.parseBody().catch(() => null);
  if (!body) return c.json({ error: "invalid_request" }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description : "";
  const file = body.file;

  if (!title) return c.json({ error: "invalid_request", message: "title is required" }, 400);
  if (!(file instanceof File)) {
    return c.json({ error: "invalid_request", message: "file is required" }, 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json({ error: "file_too_large", maxBytes: MAX_FILE_SIZE_BYTES }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const document = await createDocument({
      title,
      description,
      file: { filename: file.name, mimeType: file.type || "application/octet-stream", bytes },
    });
    return c.json(document, 201);
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      return c.json({ error: "file_too_large", maxBytes: MAX_FILE_SIZE_BYTES }, 413);
    }
    throw err;
  }
});

app.get("/api/documents/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const document = await getDocument(id);
  if (!document) return c.json({ error: "not_found" }, 404);
  return c.json(document);
});

app.patch("/api/documents/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = updateDocumentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  const document = await updateDocument(id, parsed.data);
  if (!document) return c.json({ error: "not_found" }, 404);
  return c.json(document);
});

app.delete("/api/documents/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const deleted = await deleteDocument(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});

async function serveDocumentFile(c: Context, id: number): Promise<Response> {
  const file = await getDocumentFile(id);
  if (!file) return c.json({ error: "not_found" }, 404);

  const bytes = await readFile(file.path).catch(() => null);
  if (!bytes) return c.json({ error: "file_missing" }, 404);

  const safeFallback = file.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  c.header("Content-Type", file.mimeType);
  c.header(
    "Content-Disposition",
    `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`
  );
  return c.body(bytes);
}

app.get("/api/documents/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  return serveDocumentFile(c, id);
});

mountExhibitSearchRoutes(app, { search: searchDocumentExhibits, resolve: resolveDocumentExhibits });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncDocumentExhibitByExhibitId
);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
