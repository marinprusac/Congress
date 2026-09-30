import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { requireSession } from "../sessionAuth.js";
import { getTypeBySlug, listTypes, listVersions, recordCount } from "./store.js";
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  RecordConflictError,
  RecordNotFoundError,
  RecordValidationError,
  updateRecord,
} from "./records.js";
import { resolveLegacyAlias } from "./aliases.js";
import { contentDisposition, filePath, FileTooLargeError, getFile, isInlineMime, resolveByteRange, storeUpload } from "./files.js";
import { ULID_PATTERN } from "./ulid.js";
import { env } from "../env.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createStreamBody } from "@hono/node-server/utils/stream";

// Session-gated REST for types and records, mounted at /congress.
export const typeRoutes = new Hono<{ Bindings: HttpBindings }>();

const summary = (t: ReturnType<typeof listTypes>[number]) => ({
  id: t.id,
  version: t.version,
  origin: t.origin,
  definition: t.definition,
  forked: t.forked,
  recordCount: recordCount(t.id),
});

typeRoutes.get("/types", requireSession, (c) => c.json(listTypes({ includeHidden: c.req.query("all") === "1" }).map(summary)));

typeRoutes.get("/types/:slug", requireSession, (c) => {
  const t = getTypeBySlug(c.req.param("slug"));
  return t ? c.json(summary(t)) : c.json({ error: "not_found" }, 404);
});

typeRoutes.get("/types/:slug/versions", requireSession, (c) => {
  const t = getTypeBySlug(c.req.param("slug"));
  return t ? c.json(listVersions(t.id)) : c.json({ error: "not_found" }, 404);
});

function fail(c: Context, err: unknown) {
  if (err instanceof RecordNotFoundError) return c.json({ error: "not_found", message: err.message }, 404);
  if (err instanceof RecordValidationError) return c.json({ error: "invalid_request", issues: err.issues }, 400);
  if (err instanceof RecordConflictError) return c.json({ error: "unique_conflict", field: err.field }, 409);
  throw err;
}

typeRoutes.get("/records", requireSession, (c) => {
  const type = c.req.query("type");
  if (!type) return c.json({ error: "invalid_request", message: "type is required" }, 400);
  try {
    return c.json(listRecords(type, { limit: Number(c.req.query("limit") ?? 50), offset: Number(c.req.query("offset") ?? 0) }));
  } catch (err) {
    return fail(c, err);
  }
});

typeRoutes.get("/records/:id", requireSession, (c) => {
  const record = getRecord(c.req.param("id"));
  return record ? c.json(record) : c.json({ error: "not_found" }, 404);
});

typeRoutes.post("/records", requireSession, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { type?: unknown; values?: unknown } | null;
  if (!body || typeof body.type !== "string") return c.json({ error: "invalid_request", message: "type is required" }, 400);
  try {
    return c.json(createRecord(body.type, body.values ?? {}, { actor: "me" }), 201);
  } catch (err) {
    return fail(c, err);
  }
});

typeRoutes.patch("/records/:id", requireSession, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { values?: unknown } | null;
  try {
    return c.json(updateRecord(c.req.param("id"), body?.values ?? {}, { actor: "me" }));
  } catch (err) {
    return fail(c, err);
  }
});

typeRoutes.delete("/records/:id", requireSession, (c) => {
  try {
    deleteRecord(c.req.param("id"), { actor: "me" });
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

// Raw body upload (no multipart), streamed to disk; ?name= is the filename.
typeRoutes.put("/files", requireSession, async (c) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > env.MAX_UPLOAD_BYTES) return c.json({ error: "file_too_large", maxBytes: env.MAX_UPLOAD_BYTES }, 413);
  try {
    const ref = await storeUpload(c.req.raw.body, { name: c.req.query("name") ?? "file", mime: c.req.header("content-type") });
    return c.json(ref, 201);
  } catch (err) {
    if (err instanceof FileTooLargeError) return c.json({ error: "file_too_large", maxBytes: err.maxBytes }, 413);
    throw err;
  }
});

typeRoutes.get("/files/:id", requireSession, async (c) => {
  const id = c.req.param("id");
  const file = ULID_PATTERN.test(id) ? getFile(id) : null;
  const stats = file ? await stat(filePath(file.id)).catch(() => null) : null;
  if (!file || !stats) return c.json({ error: "not_found" }, 404);

  const inline = isInlineMime(file.mime) && c.req.query("download") !== "1";
  const etag = `"${file.sha256}"`;
  c.header("Content-Type", file.mime);
  c.header("Content-Disposition", contentDisposition(file.name, inline));
  // Only inert types render inline (never HTML/SVG), and never sniffed into one.
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  c.header("ETag", etag);
  c.header("Accept-Ranges", "bytes");
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);

  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const range = resolveByteRange(rangeHeader, stats.size);
    if (!range) {
      c.header("Content-Range", `bytes */${stats.size}`);
      return c.body(null, 416);
    }
    c.header("Content-Length", String(range.end - range.start + 1));
    c.header("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
    return c.body(createStreamBody(createReadStream(filePath(file.id), { start: range.start, end: range.end })), 206);
  }
  c.header("Content-Length", String(stats.size));
  return c.body(createStreamBody(createReadStream(filePath(file.id))));
});

typeRoutes.get("/exhibits/legacy/:chamber/:id", requireSession, (c) => {
  const recordId = resolveLegacyAlias(c.req.param("chamber"), c.req.param("id"));
  return recordId ? c.json({ id: recordId, url: `/e/${recordId}` }) : c.json({ error: "not_found" }, 404);
});
