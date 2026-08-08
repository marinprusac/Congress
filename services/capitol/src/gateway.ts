import type { Context } from "hono";
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

  const forwardHeaders = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }

  try {
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
  } catch {
    return c.json({ error: "chamber_unreachable", chamber: chamberName }, 503);
  }
}
