import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";

export interface FakeChamber {
  /** e.g. http://127.0.0.1:41234 - what a real Chamber's frontend is served from. */
  origin: string;
  /** e.g. http://127.0.0.1:41234/api - what a manifest's apiBase looks like. */
  apiBase: string;
  /** Every request this chamber actually received, in order. */
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

export interface ReceivedRequest {
  method: string;
  /** Path plus query string, exactly as it arrived. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

// A real HTTP server on an ephemeral port, not a stubbed global fetch.
// Congress's gateway is largely a set of header/body/stream behaviours -
// hop-by-hop stripping, the content-encoding and content-length deletion
// undici's transparent decompression forces, redirect: "manual" - and none
// of those are observable against a fake fetch that never touches the wire.
export async function startFakeChamber(configure?: (app: Hono) => void): Promise<FakeChamber> {
  const received: ReceivedRequest[] = [];
  const app = new Hono();

  app.use("*", async (c, next) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) headers[key.toLowerCase()] = value;
    const body = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.raw.clone().text();
    received.push({ method: c.req.method, url: c.req.url.slice(new URL(c.req.url).origin.length), headers, body });
    await next();
  });

  configure?.(app);

  // A default so an unconfigured fake chamber still answers something
  // recognisable rather than Hono's bare 404.
  app.all("*", (c) => c.json({ ok: true, path: c.req.path }));

  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({ server: s, port: (info as AddressInfo).port });
    });
  });
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    apiBase: `${origin}/api`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
