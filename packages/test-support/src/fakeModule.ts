import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { ChamberSubscription, EventDelivery, Manifest } from "@congress/shared-types";
import { makeManifest } from "./manifest.js";
import type { ReceivedRequest } from "./fakeChamber.js";

// Structurally a chamber-kit ChamberModule (typed here without importing
// chamber-kit, which depends on this package), plus what it received.
export interface FakeChamberModule {
  manifest: Manifest;
  app: Hono<{ Bindings: HttpBindings }>;
  registerTools: (server: unknown) => void;
  dir: string;
  initEnv: (source: Record<string, string | undefined>) => void;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  subscriptions?: () => ChamberSubscription[];
  onEvent?: (event: EventDelivery) => void | Promise<void>;
  received: ReceivedRequest[];
}

export interface FakeChamberModuleOptions {
  // Routes are the Chamber's own, e.g. app.get("/api/feed", ...).
  configure?: (app: Hono<{ Bindings: HttpBindings }>) => void;
  manifest?: Partial<Manifest>;
  dir?: string;
  registerTools?: FakeChamberModule["registerTools"];
  start?: FakeChamberModule["start"];
  stop?: FakeChamberModule["stop"];
  subscriptions?: FakeChamberModule["subscriptions"];
  onEvent?: FakeChamberModule["onEvent"];
}

// An in-process Chamber for Congress's tests - what the loader, gateway and
// fan-out code call into instead of a real Chamber's module.
export function makeFakeChamberModule(name: string, opts: FakeChamberModuleOptions = {}): FakeChamberModule {
  const received: ReceivedRequest[] = [];
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.use("*", async (c, next) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) headers[key.toLowerCase()] = value;
    const body = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.raw.clone().text();
    received.push({ method: c.req.method, url: c.req.url.slice(new URL(c.req.url).origin.length), headers, body });
    await next();
  });
  opts.configure?.(app);

  return {
    manifest: makeManifest(name, opts.manifest),
    app,
    registerTools: opts.registerTools ?? (() => {}),
    dir: opts.dir ?? `/nonexistent/chamber-${name}`,
    initEnv: () => {},
    start: opts.start ?? (() => {}),
    stop: opts.stop ?? (() => {}),
    subscriptions: opts.subscriptions,
    onEvent: opts.onEvent,
    received,
  };
}
