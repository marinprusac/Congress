import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cacheControlFor } from "@congress/chamber-kit";
import { ACTOR_HEADER } from "@congress/shared-types";
import { getChamber } from "./registry.js";
import { getModule } from "./chambers/runtime.js";
import { hasValidSession } from "./sessionAuth.js";

// "/api/<name>/rest" -> "/rest". The routes are registered with that exact
// prefix, so a plain slice is enough.
export function stripPrefix(path: string, prefix: string): string {
  return path.slice(prefix.length);
}

// Hands a browser request to a Chamber's own Hono app, in-process. `actor`
// is who it's attributed to downstream (ACTOR_HEADER); a client-supplied
// value is always discarded - the gateway is the only thing that vouches
// for identity.
export async function dispatchToChamber(c: Context, chamberName: string, path: string, actor?: string): Promise<Response> {
  const chamber = getChamber(chamberName);
  if (!chamber) return c.json({ error: "chamber_not_found", chamber: chamberName }, 404);
  const module = getModule(chamberName);
  if (chamber.status !== "active" || !module) return c.json({ error: "chamber_offline", chamber: chamberName }, 503);

  const headers = new Headers(c.req.raw.headers);
  headers.delete(ACTOR_HEADER);
  if (actor) headers.set(ACTOR_HEADER, actor);

  const method = c.req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const search = new URL(c.req.url).search;
  const request = new Request(`http://${chamberName}.chamber/api${path}${search}`, {
    method,
    headers,
    body: hasBody ? c.req.raw.body : undefined,
    duplex: hasBody ? "half" : undefined,
  } as RequestInit);
  return module.app.fetch(request, c.env);
}

// "/api/:chamber/*", behind requireSession, so the caller is the owner.
export function forwardToChamber(c: Context): Promise<Response> {
  const chamberName = c.req.param("chamber") ?? "";
  return dispatchToChamber(c, chamberName, stripPrefix(c.req.path, `/api/${chamberName}`), "me");
}

// A Chamber's icon (frontend/public/icons/mark.svg, copied into dist/ by
// the build). Public: an icon carries nothing sensitive. Any miss is a 404
// and the caller falls back to a generic mark.
// Runtime exhibit types share one mark for now (typeEngine's "e").
const icon = (name: string) => fileURLToPath(new URL(`../frontend/public/icons/${name}.svg`, import.meta.url));
// Congress's own marks: records, and the views that replaced Chambers (same names, so pins keep theirs).
const CORE_ICONS: Record<string, string> = {
  e: icon("record"),
  types: icon("record"),
  builder: icon("record"),
  events: icon("events"),
  fitness: icon("fitness"),
  map: icon("map"),
  whatsapp: icon("whatsapp"),
};

export async function serveChamberIcon(c: Context, chamberName: string): Promise<Response> {
  const core = CORE_ICONS[chamberName];
  if (core) {
    const svg = await readFile(core);
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
  }
  const module = getModule(chamberName);
  if (!module || getChamber(chamberName)?.status !== "active") {
    return c.json({ error: "chamber_not_found", chamber: chamberName }, 404);
  }
  for (const dir of ["frontend/dist", "frontend/public"]) {
    const svg = await readFile(join(module.dir, dir, "icons/mark.svg")).catch(() => null);
    if (svg) return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
  }
  return c.json({ error: "chamber_not_found", chamber: chamberName }, 404);
}

// A Chamber's built frontend assets (remote-entry.js/css, assets/*,
// icons/*) at "/<name>/*", read from its own frontend/dist. Anything that
// isn't a file there falls through to Congress's own SPA shell.
const assetServers = new Map<string, MiddlewareHandler>();

const ASSET_PATH = /\/[^/]+\.[a-z0-9]+$/i;

export const serveChamberAssets: MiddlewareHandler = async (c, next) => {
  const chamberName = c.req.param("chamberName") ?? "";
  const module = getModule(chamberName);
  if (!module || getChamber(chamberName)?.status !== "active") return next();
  // Navigation paths (and the Chamber's own standalone index.html) belong
  // to Congress's shell.
  if (!ASSET_PATH.test(c.req.path) || c.req.path.endsWith("/index.html")) return next();
  if (!(await hasValidSession(c))) return c.json({ error: "unauthorized" }, 401);

  let server = assetServers.get(chamberName);
  if (!server) {
    const root = join(module.dir, "frontend/dist");
    if (!existsSync(root)) return next();
    server = serveStatic({ root, precompressed: true, rewriteRequestPath: (p) => stripPrefix(p, `/${chamberName}`) });
    assetServers.set(chamberName, server);
  }

  const cacheControl = cacheControlFor(c.req.path);
  if (cacheControl) c.header("Cache-Control", cacheControl);
  return server(c, next);
};
