import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsDir, TEST_INTERNAL_TOKEN, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { app } from "./server.js";
import { startConnectors, stopConnectors } from "./connectors/registry.js";
import { healthConnector } from "./connectors/health/index.js";
import { updateHealthSettings } from "./connectors/health/store.js";

const internal = { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN };
const json = { "Content-Type": "application/json" };

function bindings() {
  return { incoming: { socket: { remoteAddress: "10.0.0.1" } } } as unknown as HttpBindings;
}

let sessionCookie: string;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));

  const res = await app.request(
    "/auth/login",
    { method: "POST", headers: { ...json, "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ password: TEST_MASTER_PASSWORD }) },
    bindings()
  );
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;
});

function session() {
  return { cookie: sessionCookie };
}

// The auth matrix is pure wiring: which middleware sits on which route.
// Nothing about it is type-checked, and a route added or moved during a
// refactor can silently become public or silently stop working. Every route
// Congress exposes is asserted here from both sides.
describe("public routes", () => {
  it("serves the manifest without any credential", async () => {
    expect((await app.request("/manifest")).status).toBe(200);
  });

  it("serves health without any credential", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });

  it("serves the privacy policy and terms without a credential", async () => {
    const res = await app.request("/privacy");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Google API Services User Data Policy");
    const terms = await app.request("/terms");
    expect(terms.headers.get("location")).toBe("/privacy#terms");
  });

  it("reports auth status without a credential", async () => {
    expect((await app.request("/auth/status", {}, bindings())).status).toBe(200);
  });
});

describe("routes that went away with Chamber processes", () => {
  it.each(["/congress/register", "/congress/deregister", "/congress/heartbeat", "/congress/exhibits/sync", "/congress/events/publish", "/congress/ai/run"])(
    "no longer answers POST %s, even with the internal token",
    async (path) => {
      const res = await app.request(path, { method: "POST", headers: { ...internal, ...json }, body: "{}" }, bindings());
      expect(res.status).not.toBeLessThan(400);
    }
  );
});

describe("session-only routes", () => {
  const cases: { method: string; path: string; body?: unknown }[] = [
    { method: "GET", path: "/congress/settings" },
    { method: "PUT", path: "/congress/settings", body: { darkMode: true } },
    { method: "GET", path: "/congress/exhibits/search?q=x" },
    { method: "POST", path: "/congress/exhibits/resolve", body: { refs: [] } },
    { method: "GET", path: "/congress/exhibits/note-1/connections" },
    // Core features folded in from the retired Capitol/Logs Chambers.
    { method: "GET", path: "/congress/event-settings" },
    { method: "GET", path: "/congress/history" },
    { method: "GET", path: "/congress/notifications" },
    { method: "GET", path: "/congress/push/config" },
    // AI. POST /chat/messages is left out on purpose: an accepted one would
    // spawn a real `claude` run.
    { method: "GET", path: "/congress/ai/threads" },
    { method: "GET", path: "/congress/ai/queue" },
    { method: "GET", path: "/congress/ai/runs" },
    { method: "GET", path: "/congress/ai/settings" },
    { method: "PUT", path: "/congress/ai/settings", body: { contextPrompt: "" } },
    { method: "GET", path: "/congress/ai/settings/spend" },
    { method: "GET", path: "/congress/feed" },
  ];

  it.each(cases)("401s $method $path without a session", async ({ method, path, body }) => {
    const res = await app.request(path, { method, headers: json, body: body ? JSON.stringify(body) : undefined });
    expect(res.status).toBe(401);
  });

  it.each(cases)("401s $method $path when offered only the internal token", async ({ method, path, body }) => {
    const res = await app.request(path, { method, headers: { ...internal, ...json }, body: body ? JSON.stringify(body) : undefined });
    expect(res.status).toBe(401);
  });

  it.each(cases)("accepts $method $path with a session", async ({ method, path, body }) => {
    const res = await app.request(
      path,
      { method, headers: { ...json, ...session() }, body: body ? JSON.stringify(body) : undefined },
      bindings()
    );
    expect(res.status).toBeLessThan(400);
  });
});

describe("request validation", () => {
  it("round-trips the home screen's pinned views, in order, without touching dark mode", async () => {
    const pinnedViews = [
      { chamber: "calendar", viewId: "upcoming" },
      { chamber: "tasks", viewId: "open" },
    ];
    const put = await app.request(
      "/congress/settings",
      { method: "PUT", headers: { ...json, ...session() }, body: JSON.stringify({ pinnedViews }) },
      bindings()
    );
    expect(put.status).toBe(200);
    const got = (await (await app.request("/congress/settings", { headers: session() }, bindings())).json()) as { pinnedViews: unknown; darkMode: unknown };
    expect(got.pinnedViews).toEqual(pinnedViews);
    expect(typeof got.darkMode).toBe("boolean");
  });

  it("400s a malformed pinned view", async () => {
    const res = await app.request(
      "/congress/settings",
      { method: "PUT", headers: { ...json, ...session() }, body: JSON.stringify({ pinnedViews: [{ chamber: "tasks" }] }) },
      bindings()
    );
    expect(res.status).toBe(400);
  });

  it("400s a settings update with the wrong shape", async () => {
    const res = await app.request(
      "/congress/settings",
      { method: "PUT", headers: { ...json, ...session() }, body: JSON.stringify({ darkMode: "yes" }) },
      bindings()
    );
    expect(res.status).toBe(400);
  });
});

describe("retired Chamber paths", () => {
  it("404s any /api path that isn't a route, rather than serving the shell", async () => {
    const res = await app.request("/api/notes/anything", { headers: session() }, bindings());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });

  it("falls through to Congress's own frontend for a page path, including a retired Chamber's", async () => {
    const res = await app.request("/whatsapp/c/x", {}, bindings());
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });
});

describe("POST /api/fitness/health/ingest", () => {
  // The one deliberate exception to "every /api/* request needs a session":
  // the owner's Shortcut can't present one. The health connector's webhook
  // checks its own token.
  it("404s if the health connector isn't running", async () => {
    const res = await app.request("/api/fitness/health/ingest", { method: "POST", headers: json, body: "{}" }, bindings());
    expect(res.status).toBe(404);
  });

  it("reaches the health connector's webhook with no session, which checks the token", async () => {
    await startConnectors([healthConnector]);
    updateHealthSettings({ ingestToken: "owner-secret" });
    const post = (token: string) =>
      app.request("/api/fitness/health/ingest", { method: "POST", headers: { ...json, "X-Health-Ingest-Token": token }, body: JSON.stringify({ metrics: [] }) }, bindings());
    expect((await post("wrong")).status).toBe(401);
    const res = await post("owner-secret");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accepted: 0, duplicated: 0, skipped: 0 });
    await stopConnectors();
  });
});

describe("mcp mounts", () => {
  // Real HTTP: the `claude` CLI reaches these as a separate process.
  let server: ServerType;
  let origin: string;
  beforeAll(async () => {
    server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("gates Congress's own /mcp with the shared secret", async () => {
    expect((await app.request("/mcp", { method: "POST", headers: json, body: "{}" })).status).toBe(401);
  });

  it("gates the types and builder servers with the shared secret", async () => {
    expect((await fetch(`${origin}/mcp/types`, { method: "POST", headers: json, body: "{}" })).status).toBe(401);
    expect((await fetch(`${origin}/mcp/builder`, { method: "POST", headers: json, body: "{}" })).status).toBe(401);
  });
});
