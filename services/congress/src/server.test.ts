import type { HttpBindings } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir, startFakeChamber, type FakeChamber, TEST_INTERNAL_TOKEN, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { app } from "./server.js";

const internal = { "X-Congress-Internal-Token": TEST_INTERNAL_TOKEN };
const json = { "Content-Type": "application/json" };

function bindings() {
  return { incoming: { socket: { remoteAddress: "10.0.0.1" } } } as unknown as HttpBindings;
}

let sessionCookie: string;
let chamber: FakeChamber;

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));

  const res = await app.request(
    "/auth/login",
    { method: "POST", headers: { ...json, "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ password: TEST_MASTER_PASSWORD }) },
    bindings()
  );
  sessionCookie = res.headers.get("set-cookie")!.split(";")[0]!;

  chamber = await startFakeChamber((c) => {
    c.get("/api/notes", (ctx) => ctx.json([{ id: 1, title: "One" }]));
    c.get("/icons/mark.svg", (ctx) => ctx.body("<svg/>", 200, { "content-type": "image/svg+xml" }));
  });
});

afterAll(async () => {
  await chamber.close();
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

  it("serves a chamber icon without any credential", async () => {
    // Deliberately open: an icon carries nothing sensitive, and callers fall
    // back to a generic mark rather than treating a failure as an error.
    await app.request("/congress/register", { method: "POST", headers: { ...internal, ...json }, body: JSON.stringify(makeManifest("iconic", chamber.origin)) });
    const res = await app.request("/congress/chambers/iconic/icon");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<svg/>");
  });

  it("reports auth status without a credential", async () => {
    expect((await app.request("/auth/status", {}, bindings())).status).toBe(200);
  });
});

describe("internal-token-only routes", () => {
  const cases: { method: string; path: string; body: unknown }[] = [
    { method: "POST", path: "/congress/register", body: makeManifest("gate-a") },
    { method: "POST", path: "/congress/deregister", body: { name: "gate-a" } },
    { method: "POST", path: "/congress/heartbeat", body: { name: "gate-a" } },
    {
      method: "POST",
      path: "/congress/exhibits/sync",
      body: { chamber: "notes", id: "note-1", type: "note", name: "One", url: "/n/1", outgoingRefs: [] },
    },
    { method: "POST", path: "/congress/events/publish", body: { chamber: "notes", type: "notes.created", payload: {} } },
  ];

  it.each(cases)("401s $method $path without the token", async ({ method, path, body }) => {
    const res = await app.request(path, { method, headers: json, body: JSON.stringify(body) });
    expect(res.status).toBe(401);
  });

  it.each(cases)("401s $method $path when offered only a session cookie", async ({ method, path, body }) => {
    // A browser session must not be able to impersonate a Chamber.
    const res = await app.request(path, { method, headers: { ...json, ...session() }, body: JSON.stringify(body) }, bindings());
    expect(res.status).toBe(401);
  });

  it.each(cases)("accepts $method $path with the token", async ({ method, path, body }) => {
    const res = await app.request(path, { method, headers: { ...internal, ...json }, body: JSON.stringify(body) });
    expect(res.status).toBeLessThan(400);
  });
});

describe("session-only routes", () => {
  const cases: { method: string; path: string; body?: unknown }[] = [
    { method: "GET", path: "/congress/settings" },
    { method: "PUT", path: "/congress/settings", body: { darkMode: true } },
    { method: "GET", path: "/congress/exhibits/search?q=x" },
    { method: "GET", path: "/congress/exhibits/note-1/connections" },
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

describe("/congress/registry", () => {
  it("accepts either a session or the internal token", async () => {
    // A Chamber's own backend reads this to resolve another Chamber's mcpUrl,
    // and the browser reads it to build the nav - hence both.
    expect((await app.request("/congress/registry", { headers: internal })).status).toBe(200);
    expect((await app.request("/congress/registry", { headers: session() }, bindings())).status).toBe(200);
  });

  it("401s with neither", async () => {
    expect((await app.request("/congress/registry")).status).toBe(401);
  });
});

describe("POST /congress/exhibits/resolve", () => {
  it("accepts either a session or the internal token", async () => {
    // A Chamber's own backend resolves tokens too now (e.g. chamber-calendar
    // projecting a rich value's tokens to plain labels before syncing to
    // Google), and it has no session cookie to present - only the browser
    // does, for live chip resolution.
    const body = JSON.stringify({ refs: [] });
    expect((await app.request("/congress/exhibits/resolve", { method: "POST", headers: { ...internal, ...json }, body })).status).toBe(200);
    expect(
      (await app.request("/congress/exhibits/resolve", { method: "POST", headers: { ...json, ...session() }, body }, bindings())).status
    ).toBe(200);
  });

  it("401s with neither", async () => {
    const res = await app.request("/congress/exhibits/resolve", { method: "POST", headers: json, body: JSON.stringify({ refs: [] }) });
    expect(res.status).toBe(401);
  });
});

describe("request validation", () => {
  it("400s a register call with a malformed manifest", async () => {
    const res = await app.request("/congress/register", {
      method: "POST",
      headers: { ...internal, ...json },
      body: JSON.stringify({ name: "broken" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_manifest" });
  });

  it("400s a heartbeat with no name", async () => {
    const res = await app.request("/congress/heartbeat", { method: "POST", headers: { ...internal, ...json }, body: "{}" });
    expect(res.status).toBe(400);
  });

  it("404s a heartbeat for a chamber that never registered", async () => {
    const res = await app.request("/congress/heartbeat", {
      method: "POST",
      headers: { ...internal, ...json },
      body: JSON.stringify({ name: "never-registered" }),
    });
    expect(res.status).toBe(404);
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

describe("register -> registry -> proxy -> deregister", () => {
  it("carries a chamber all the way from registration to a proxied API call and back out", async () => {
    const manifest = makeManifest("e2e", chamber.origin);

    const registered = await app.request("/congress/register", {
      method: "POST",
      headers: { ...internal, ...json },
      body: JSON.stringify(manifest),
    });
    expect(registered.status).toBe(201);

    const registry = (await (await app.request("/congress/registry", { headers: internal })).json()) as { name: string }[];
    expect(registry.map((c) => c.name)).toContain("e2e");

    const proxied = await app.request("/api/e2e/notes", { headers: session() }, bindings());
    expect(proxied.status).toBe(200);
    await expect(proxied.json()).resolves.toEqual([{ id: 1, title: "One" }]);

    await app.request("/congress/deregister", {
      method: "POST",
      headers: { ...internal, ...json },
      body: JSON.stringify({ name: "e2e" }),
    });

    const afterDeregister = await app.request("/api/e2e/notes", { headers: session() }, bindings());
    expect(afterDeregister.status).toBe(503);
    await expect(afterDeregister.json()).resolves.toEqual({ error: "chamber_offline", chamber: "e2e" });
  });

  it("401s a proxied API call without a session", async () => {
    expect((await app.request("/api/e2e/notes")).status).toBe(401);
  });
});

describe("chamber frontend proxy", () => {
  it("does not shadow Congress's own routes for an unregistered first path segment", async () => {
    // The proxy only intercepts paths whose first segment is an actually
    // registered chamber; anything else has to fall through to the static
    // frontend rather than 503ing.
    const res = await app.request("/some-unregistered-path", {}, bindings());
    expect(res.status).not.toBe(503);
  });

  it("401s a registered chamber's frontend without a session", async () => {
    await app.request("/congress/register", {
      method: "POST",
      headers: { ...internal, ...json },
      body: JSON.stringify(makeManifest("fronted", chamber.origin)),
    });
    const res = await app.request("/fronted/anything", {}, bindings());
    expect(res.status).toBe(401);
  });
});

describe("mcp mount", () => {
  it("is gated by the same shared secret Chambers use", async () => {
    const unauth = await app.request("/mcp", { method: "POST", headers: json, body: "{}" });
    expect(unauth.status).toBe(401);
  });
});
