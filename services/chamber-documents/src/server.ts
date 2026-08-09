import { readFile } from "node:fs/promises";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { updateDocumentRequestSchema, exhibitResolveRequestSchema } from "@congress/shared-types";
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
} from "./documents.js";
import { searchDocumentExhibits, resolveDocumentExhibits } from "./exhibits.js";
import { mcpApp } from "./mcp/server.js";

export const app = new Hono<{ Bindings: HttpBindings }>();

app.get("/manifest", (c) => c.json(documentsManifest));
app.get("/health", (c) => c.json({ status: "ok" }));

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

app.get("/api/documents/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
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
});

// An empty query returns the most recently updated documents rather than
// nothing - it's what the cross-Chamber "[[" picker shows on open.
app.get("/api/exhibits/search", async (c) => {
  const query = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit")) || undefined;
  return c.json({ results: await searchDocumentExhibits(query, limit) });
});

app.post("/api/exhibits/resolve", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = exhibitResolveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.flatten() }, 400);
  }
  return c.json({ results: await resolveDocumentExhibits(parsed.data.ids) });
});

app.route("/mcp", mcpApp);

app.use(
  "/*",
  serveStatic({
    root: "./frontend/dist",
  })
);
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));
