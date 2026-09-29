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
// There is no other method: the reader API is read-only and so is this.
export function readerGet(path: string, timeoutMs = 10_000): Promise<Response> {
  return new Promise((resolvePromise) => {
    const unavailable = (detail: string) =>
      resolvePromise(Response.json({ error: "reader_unavailable", detail }, { status: 503 }));
    const req = request({ socketPath: env.WA_READER_SOCKET, path, method: "GET", timeout: timeoutMs }, (res) => {
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
    req.end();
  });
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
