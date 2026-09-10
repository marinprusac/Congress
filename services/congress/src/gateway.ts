import type { Context } from "hono";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { getChamber } from "./registry.js";

const FORWARD_TIMEOUT_MS = 10_000;

// Both Deputy's chat POST (chat.ts) and its "Run now" directive POST
// (server.ts's POST /api/directives/:id/run) block on a full headless
// `claude` run before responding - unlike every other Chamber route, which
// answers in milliseconds, either of these can legitimately take minutes
// (multiple cross-Chamber MCP tool calls). The default FORWARD_TIMEOUT_MS
// would abort the proxy well before that run finishes, surfacing a false
// "chamber unreachable" (or, for the directive route, silently eating the
// response so the Play button's mutation just errors out) to the owner even
// though the run itself completes fine and gets persisted - the
// reload-and-it's-there symptom this constant fixes.
const DEPUTY_BLOCKING_RUN_TIMEOUT_MS = 5 * 60 * 1000;

// Matches "/directives/<id>/run" - the one dynamic-segment route among
// Deputy's blocking routes, so it needs a pattern rather than the other two's
// plain string equality.
const DEPUTY_DIRECTIVE_RUN_PATH = /^\/directives\/\d+\/run$/;

// Deputy's own run-progress SSE stream (see chamber-deputy/src/server.ts's
// GET /api/runs/stream) is meant to stay open indefinitely, not just longer
// than the default - AbortSignal.timeout(Infinity) itself throws, so
// timeoutFor returns Infinity here and proxyRequest below skips
// constructing a timeout signal at all for it.
const DEPUTY_STREAM_NO_TIMEOUT = Infinity;

// A Chamber's registered apiBase is its origin plus "/api"; its frontend and
// its public assets are served from the origin itself. Named rather than
// inlined at each call site both because it is the same rule twice over and
// because it is the sort of thing that silently keeps "working" against a
// mis-shaped apiBase.
export function frontendBaseOf(apiBase: string): string {
  return apiBase.replace(/\/api$/, "");
}

// Strips a known fixed prefix off the incoming path and re-attaches the
// query string against a new base. Compiling a RegExp (and treating the
// chamber name as a pattern) on every proxied request would be needless work
// - the routes are registered as "/api/:chamber/*" and "/:chamberName/*", so
// the path is always known to start with exactly this prefix.
export function rewriteChamberPath(path: string, prefix: string, base: string, search: string, fallback = ""): string {
  const remainder = path.slice(prefix.length) || fallback;
  return `${base}${remainder}${search}`;
}

// Deputy's chat and "Run now" POSTs both block on a full headless `claude`
// run before responding; every other Chamber route answers in milliseconds.
// See DEPUTY_BLOCKING_RUN_TIMEOUT_MS above.
export function timeoutFor(chamberName: string, method: string, remainder: string): number {
  if (chamberName !== "deputy") return FORWARD_TIMEOUT_MS;
  if (method === "POST" && remainder === "/chat/messages") return DEPUTY_BLOCKING_RUN_TIMEOUT_MS;
  if (method === "POST" && DEPUTY_DIRECTIVE_RUN_PATH.test(remainder)) return DEPUTY_BLOCKING_RUN_TIMEOUT_MS;
  if (method === "GET" && remainder === "/runs/stream") return DEPUTY_STREAM_NO_TIMEOUT;
  return FORWARD_TIMEOUT_MS;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

async function proxyRequest(c: Context, targetUrl: string, timeoutMs: number = FORWARD_TIMEOUT_MS): Promise<Response> {
  const forwardHeaders = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }

  const method = c.req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const response = await fetch(targetUrl, {
    method,
    headers: forwardHeaders,
    body: hasBody ? c.req.raw.body : undefined,
    duplex: hasBody ? "half" : undefined,
    // Relay a Chamber's redirect (e.g. an OAuth "start" route sending the
    // browser to Google) as-is, rather than following it server-side —
    // fetch() would otherwise silently resolve the redirect target itself
    // and hand back that page's body under this request's original status.
    redirect: "manual",
    // AbortSignal.timeout(Infinity) itself throws - a stream meant to stay
    // open indefinitely (see DEPUTY_STREAM_NO_TIMEOUT above) passes no
    // signal at all rather than an unreachable one.
    signal: Number.isFinite(timeoutMs) ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  // fetch() (undici) transparently decompresses a gzip/br/deflate response
  // before we ever see `response.body` - it does not update `content-encoding`
  // or `content-length` to match, since those reflect the wire response, not
  // the decoded body it hands back. Relaying those two headers as-is while
  // piping the already-decoded body lies to the browser about both the
  // encoding and the length of what's actually being sent, which fails with
  // ERR_CONTENT_DECODING_FAILED - this only started biting once a Chamber's
  // own static serving began returning compressed responses at all (see
  // chamber-kit routes.ts's `precompressed: true`).
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function forwardToChamber(c: Context): Promise<Response> {
  const chamberName = c.req.param("chamber") ?? "";
  const chamber = getChamber(chamberName);

  if (!chamber) {
    return c.json({ error: "chamber_not_found", chamber: chamberName }, 503);
  }

  if (chamber.status !== "active") {
    return c.json({ error: "chamber_offline", chamber: chamberName }, 503);
  }

  const apiPrefix = `/api/${chamberName}`;
  const remainder = c.req.path.slice(apiPrefix.length);
  const search = new URL(c.req.url).search;
  const targetUrl = rewriteChamberPath(c.req.path, apiPrefix, chamber.apiBase, search);

  try {
    return await proxyRequest(c, targetUrl, timeoutFor(chamberName, c.req.method, remainder));
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamberName }, 503);
  }
}

// Proxies to an explicit path on a named Chamber's apiBase, rather than
// deriving the path by stripping a fixed prefix off the incoming request
// (as forwardToChamber does for "/api/:chamber/*"). Used by the manual-refs
// routes, whose own URL shape ("/congress/exhibits/:id/refs") has nothing to
// do with the target Chamber route ("/exhibits/:id/refs").
export async function proxyToChamberPath(c: Context, chamberName: string, path: string): Promise<Response> {
  const chamber = getChamber(chamberName);

  if (!chamber) {
    return c.json({ error: "chamber_not_found", chamber: chamberName }, 503);
  }

  if (chamber.status !== "active") {
    return c.json({ error: "chamber_offline", chamber: chamberName }, 503);
  }

  const search = new URL(c.req.url).search;
  const targetUrl = `${chamber.apiBase}${path}${search}`;

  try {
    return await proxyRequest(c, targetUrl);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamberName }, 503);
  }
}

// Proxies a Chamber's own served icon (frontend/public/icons/mark.svg in
// that Chamber's own source tree, built into its dist/ root like every
// other public/ asset regardless of Vite `base`) - the mechanism that lets
// every Chamber own its icon instead of a shared package hardcoding one SVG
// per Chamber name. Public/unauthenticated: an icon carries nothing
// sensitive - same openness as /health and /manifest.
// A missing/offline Chamber or a Chamber that never shipped an icon both
// resolve to a non-2xx response; callers fall back to a generic mark
// locally rather than treating this as an error worth surfacing.
export async function proxyToChamberIcon(c: Context, chamberName: string): Promise<Response> {
  const chamber = getChamber(chamberName);

  if (!chamber || chamber.status !== "active") {
    return c.json({ error: "chamber_not_found", chamber: chamberName }, 404);
  }

  try {
    return await proxyRequest(c, `${frontendBaseOf(chamber.apiBase)}/icons/mark.svg`);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamberName }, 404);
  }
}

// Proxies a Chamber's own built frontend (its static assets + SPA shell)
// through Capitol at "/<chamberName>/*", so each Chamber's UI is reachable
// without exposing its port directly. The Chamber's frontend build must set
// its Vite `base` to "/<chamberName>/" so asset URLs round-trip through this
// same prefix.
export async function forwardToChamberFrontend(
  c: Context,
  chamber: ChamberRegistryEntry
): Promise<Response> {
  if (chamber.status !== "active") {
    return c.json({ error: "chamber_offline", chamber: chamber.name }, 503);
  }

  // Same fixed-prefix strip as forwardToChamber above, except that a bare
  // "/<chamber>" has to become "/" rather than an empty path.
  const search = new URL(c.req.url).search;
  const targetUrl = rewriteChamberPath(
    c.req.path,
    `/${chamber.name}`,
    frontendBaseOf(chamber.apiBase),
    search,
    "/"
  );

  try {
    return await proxyRequest(c, targetUrl);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamber.name }, 503);
  }
}
