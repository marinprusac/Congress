import type { Context } from "hono";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { getChamber } from "./registry.js";

const FORWARD_TIMEOUT_MS = 10_000;

// Deputy's chat POST blocks on a full headless `claude` run (chat.ts) before
// responding - unlike every other Chamber route, which answers in
// milliseconds, this one can legitimately take minutes (multiple cross-
// Chamber MCP tool calls). The default FORWARD_TIMEOUT_MS would abort the
// proxy well before that run finishes, surfacing a false "chamber
// unreachable" to the owner even though the run itself completes fine and
// gets persisted - the reload-and-it's-there symptom this constant fixes.
const DEPUTY_CHAT_TIMEOUT_MS = 5 * 60 * 1000;

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
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

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

  // Compiling a RegExp (and treating chamberName as a pattern) on every
  // proxied request is needless work for a fixed-prefix strip - the route is
  // registered as "/api/:chamber/*", so the path is always known to start
  // with this exact prefix.
  const apiPrefix = `/api/${chamberName}`;
  const remainder = c.req.path.slice(apiPrefix.length);
  const search = new URL(c.req.url).search;
  const targetUrl = `${chamber.apiBase}${remainder}${search}`;

  const timeoutMs =
    chamberName === "deputy" && c.req.method === "POST" && remainder === "/chat/messages"
      ? DEPUTY_CHAT_TIMEOUT_MS
      : FORWARD_TIMEOUT_MS;

  try {
    return await proxyRequest(c, targetUrl, timeoutMs);
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

  const frontendBase = chamber.apiBase.replace(/\/api$/, "");

  try {
    return await proxyRequest(c, `${frontendBase}/icons/mark.svg`);
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

  const frontendBase = chamber.apiBase.replace(/\/api$/, "");
  // Same fixed-prefix strip as forwardToChamber above - the path is always
  // known to start with "/<chamber.name>" here too.
  const frontendPrefix = `/${chamber.name}`;
  const remainder = c.req.path.slice(frontendPrefix.length) || "/";
  const search = new URL(c.req.url).search;
  const targetUrl = `${frontendBase}${remainder}${search}`;

  try {
    return await proxyRequest(c, targetUrl);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamber.name }, 503);
  }
}
