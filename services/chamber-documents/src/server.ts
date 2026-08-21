import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createStreamBody } from "@hono/node-server/utils/stream";
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
import { searchDocumentExhibits, resolveDocumentExhibits, chipDocumentExhibit } from "./exhibits.js";
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

  try {
    const document = await createDocument({
      title,
      description,
      file: {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        stream: () => file.stream(),
      },
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

function contentDispositionFor(filename: string): string {
  const safeFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// The three shapes a `Range` header actually takes - "start-end", "start-"
// (open-ended) and "-suffixLength". Reimplemented narrowly here (rather than
// reusing chamber-kit's static-asset serving, which already handles this)
// since a document download needs its own Content-Type/Content-Disposition,
// not whatever would be guessed from storageKey's extension-less on-disk
// path.
function resolveByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;

  let start: number;
  let end: number;
  if (startStr === "") {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

// Streams straight off disk in both directions (see the upload handler
// below too) instead of buffering the whole file into memory first - a
// large PDF used to exist in memory two or three times over (parseBody's
// own buffering, the arrayBuffer() copy, the Uint8Array copy) before a
// single byte reached the client, on a VPS running ten otherwise-tiny Node
// processes. Range support (previously absent entirely) means a resumed or
// byte-range-seeking download - a PDF viewer jumping to a page, a paused
// transfer - doesn't have to restart from the top.
async function serveDocumentFile(c: Context, id: number): Promise<Response> {
  const file = await getDocumentFile(id);
  if (!file) return c.json({ error: "not_found" }, 404);

  const stats = await stat(file.path).catch(() => null);
  if (!stats) return c.json({ error: "file_missing" }, 404);

  c.header("Content-Type", file.mimeType);
  c.header("Content-Disposition", contentDispositionFor(file.filename));
  c.header("Accept-Ranges", "bytes");

  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const range = resolveByteRange(rangeHeader, stats.size);
    if (!range) {
      c.header("Content-Range", `bytes */${stats.size}`);
      return c.body(null, 416);
    }
    c.header("Content-Length", String(range.end - range.start + 1));
    c.header("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
    return c.body(createStreamBody(createReadStream(file.path, { start: range.start, end: range.end })), 206);
  }

  c.header("Content-Length", String(stats.size));
  return c.body(createStreamBody(createReadStream(file.path)));
}

app.get("/api/documents/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  return serveDocumentFile(c, id);
});

mountExhibitSearchRoutes(app, { search: searchDocumentExhibits, resolve: resolveDocumentExhibits, chip: chipDocumentExhibit });

mountManualRefsRoutes(
  app,
  { list: listManualRefsByExhibitId, add: addManualRefByExhibitId, remove: removeManualRefByExhibitId },
  resyncDocumentExhibitByExhibitId
);

app.route("/mcp", mcpApp);

mountStaticFrontend(app);
