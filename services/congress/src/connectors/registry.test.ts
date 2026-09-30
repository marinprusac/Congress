import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationsDir, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { runMigrations } from "../db/client.js";
import { app } from "../server.js";
import { publishEvent } from "../events.js";
import { defineConnector, type Connector } from "./contract.js";
import { connectorStatus, listConnectorStatuses, startConnectors, stopConnectors } from "./registry.js";
import { onSourceChange } from "./runtime.js";
import { requestedScopes } from "./google/accounts.js";

const json = { "Content-Type": "application/json" };
const bindings = () => ({ incoming: { socket: { remoteAddress: "10.0.0.1" } } }) as unknown as HttpBindings;
let cookie: string;
const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...json, cookie, ...init.headers } }, bindings());

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  const res = await app.request(
    "/auth/login",
    { method: "POST", headers: { ...json, "x-forwarded-for": "9.9.9.7" }, body: JSON.stringify({ password: TEST_MASTER_PASSWORD }) },
    bindings()
  );
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

afterEach(() => stopConnectors());

function fake(name: string, overrides: Partial<Connector> = {}): Connector {
  return defineConnector({
    name,
    label: name.toUpperCase(),
    source: [],
    start: () => {},
    sync: async (ctx) => {
      ctx.emitChange("thing", "k1");
      return { changed: 1, error: null };
    },
    read: { get: () => null, list: () => [] },
    ...overrides,
  });
}

describe("connector registry", () => {
  it("starts connectors, isolating one that throws", async () => {
    const changes: string[] = [];
    const off = onSourceChange((c) => changes.push(`${c.connector}/${c.key}`));
    await startConnectors([fake("broken", { start: () => { throw new Error("no config"); } }), fake("fine")]);
    await vi.waitFor(() => expect(connectorStatus("fine")!.lastSyncedAt).not.toBeNull());
    expect(connectorStatus("broken")).toMatchObject({ state: "offline", lastError: "no config" });
    expect(connectorStatus("fine")).toMatchObject({ state: "active", lastError: null, label: "FINE" });
    expect(changes).toEqual(["fine/k1"]);
    off();
  });

  it("adds a started connector's Google scopes to the connect union", async () => {
    expect(requestedScopes()).not.toContain("scope:x");
    await startConnectors([fake("scoped", { googleScopes: ["scope:x"] })]);
    expect(requestedScopes()).toContain("scope:x");
    await stopConnectors();
    expect(requestedScopes()).not.toContain("scope:x");
  });

  it("forwards events to active connectors", async () => {
    const seen: string[] = [];
    await startConnectors([fake("listener", { onEvent: (_ctx, e) => void seen.push(e.type) })]);
    publishEvent({ chamber: "congress", type: "google.account_connected", payload: { accountId: 1 } });
    expect(seen).toEqual(["google.account_connected"]);
  });

  it("serves status, sync and panel routes behind the session", async () => {
    const sync = vi.fn(async () => ({ changed: 0, error: "Me needs reconnecting" }));
    const routes = () => new Hono().get("/hello", (c) => c.json({ path: new URL(c.req.url).pathname, q: c.req.query("x") }));
    await startConnectors([fake("panel", { sync, routes })]);

    expect((await app.request("/congress/connectors", {}, bindings())).status).toBe(401);
    expect((await app.request("/congress/connectors/panel/hello", {}, bindings())).status).toBe(401);
    const list = (await (await call("/congress/connectors")).json()) as { name: string }[];
    expect(list.map((c) => c.name)).toEqual(["panel"]);

    const synced = await (await call("/congress/connectors/panel/sync", { method: "POST" })).json();
    expect(synced).toMatchObject({ name: "panel", lastError: "Me needs reconnecting", syncing: false });
    expect(await (await call("/congress/connectors/panel/hello?x=1")).json()).toEqual({ path: "/hello", q: "1" });
    expect((await call("/congress/connectors/nope/sync", { method: "POST" })).status).toBe(404);
    expect((await call("/congress/connectors/nope/hello")).status).toBe(404);
    // Google's own routes still answer under the same prefix.
    expect((await call("/congress/connectors/google")).status).toBe(200);
  });

  it("stops everything", async () => {
    const stop = vi.fn();
    await startConnectors([fake("a", { stop })]);
    await stopConnectors();
    expect(stop).toHaveBeenCalled();
    expect(listConnectorStatuses()).toEqual([]);
  });
});
