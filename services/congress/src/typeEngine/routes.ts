import { Hono, type Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { requireSession } from "../sessionAuth.js";
import { getTypeBySlug, listTypes, listVersions } from "./store.js";
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

// Session-gated REST for types and records, mounted at /congress.
export const typeRoutes = new Hono<{ Bindings: HttpBindings }>();

const summary = (t: ReturnType<typeof listTypes>[number]) => ({ id: t.id, version: t.version, origin: t.origin, definition: t.definition });

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

typeRoutes.get("/exhibits/legacy/:chamber/:id", requireSession, (c) => {
  const recordId = resolveLegacyAlias(c.req.param("chamber"), c.req.param("id"));
  return recordId ? c.json({ id: recordId, url: `/e/${recordId}` }) : c.json({ error: "not_found" }, 404);
});
