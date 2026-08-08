import type { Context } from "hono";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { getChamber } from "./registry.js";

const FORWARD_TIMEOUT_MS = 10_000;

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

async function proxyRequest(c: Context, targetUrl: string): Promise<Response> {
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
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
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

  const remainder = c.req.path.replace(new RegExp(`^/api/${chamberName}`), "");
  const search = new URL(c.req.url).search;
  const targetUrl = `${chamber.apiBase}${remainder}${search}`;

  try {
    return await proxyRequest(c, targetUrl);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamberName }, 503);
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
  const remainder = c.req.path.replace(new RegExp(`^/${chamber.name}`), "") || "/";
  const search = new URL(c.req.url).search;
  const targetUrl = `${frontendBase}${remainder}${search}`;

  try {
    return await proxyRequest(c, targetUrl);
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamber.name }, 503);
  }
}
