import { request } from "node:http";
import { Readable } from "node:stream";
import { env } from "./env.js";

// Headers passed through from wa-reader; everything else is dropped.
const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "cache-control",
];

// GETs a path from wa-reader over its Unix socket and relays the response.
export function readerGet(path: string, timeoutMs = 10_000): Promise<Response> {
  return readerRequest("GET", path, timeoutMs);
}

// The only POSTs: starting a pairing session (linking, never sending) and
// marking a chat read in wa-reader's own DB (WhatsApp is never told).
export function readerStartPairing(): Promise<Response> {
  return readerRequest("POST", "/pairing", 15_000);
}

export function readerMarkReadLocally(jid: string, upTo?: string): Promise<Response> {
  const body = JSON.stringify(upTo ? { upTo } : {});
  return readerRequest("POST", `/chats/${encodeURIComponent(jid)}/read`, 10_000, body);
}

function readerRequest(method: "GET" | "POST", path: string, timeoutMs: number, body?: string): Promise<Response> {
  return new Promise((resolvePromise) => {
    const unavailable = (detail: string) =>
      resolvePromise(Response.json({ error: "reader_unavailable", detail }, { status: 503 }));
    const headers = body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
    const req = request({ socketPath: env.WA_READER_SOCKET, path, method, headers, timeout: timeoutMs }, (res) => {
      const headers = new Headers();
      for (const name of PASS_HEADERS) {
        const value = res.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
      resolvePromise(new Response(body, { status: res.statusCode ?? 502, headers }));
    });
    req.on("timeout", () => {
      req.destroy();
      unavailable("timeout");
    });
    req.on("error", (err: NodeJS.ErrnoException) => unavailable(err.code ?? err.message));
    req.end(body);
  });
}

export class ReaderError extends Error {}

// Parses a reader response for in-process callers (the MCP tools); throws the reader's error code.
export async function readerJson<T>(path: string | Promise<Response>): Promise<T> {
  const res = await (typeof path === "string" ? readerGet(path) : path);
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ReaderError(body?.error ?? `reader_http_${res.status}`);
  return body as T;
}

// Builds "/path?k=v" keeping only the named query parameters.
export function readerPath(path: string, query: Record<string, string | undefined>, allowed: string[]): string {
  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
