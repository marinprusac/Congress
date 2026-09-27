import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listChamberTools, mcpTextResult } from "@congress/chamber-kit";
import { makeFakeChamberModule, migrationsDir, TEST_INTERNAL_TOKEN, TEST_MASTER_PASSWORD } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { loadChamber } from "./chambers/loader.js";
import { detachChamber } from "./registry.js";
import { app } from "./server.js";

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

  const configure = (c: ReturnType<typeof makeFakeChamberModule>["app"]) => {
    c.get("/api/notes", (ctx) => ctx.json([{ id: 1, title: "One" }]));
    c.post("/api/health/ingest", async (ctx) =>
      ctx.json({ receivedToken: ctx.req.header("x-health-ingest-token") ?? null, body: await ctx.req.json() })
    );
  };
  await loadChamber(makeFakeChamberModule("e2e", { configure }), { envFor: () => ({}) });
  await loadChamber(
    makeFakeChamberModule("tooled", {
      registerTools: (server) =>
        (server as McpServer).registerTool("ping", { title: "Ping", description: "Answers pong." }, async () => mcpTextResult("pong")),
    }),
    { envFor: () => ({}) }
  );
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
    { method: "GET", path: "/congress/registry" },
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
    { method: "GET", path: "/api/e2e/notes" },
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

describe("load -> registry -> API -> detach", () => {
  it("carries a loaded chamber from the registry to an API call and back out", async () => {
    const registry = (await (await app.request("/congress/registry", { headers: session() }, bindings())).json()) as { name: string; status: string; mcpUrl?: string }[];
    expect(registry.find((c) => c.name === "e2e")).toMatchObject({ status: "active", mcpUrl: "http://127.0.0.1:3000/mcp/e2e" });

    const res = await app.request("/api/e2e/notes", { headers: session() }, bindings());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 1, title: "One" }]);
  });

  it("503s once the owner detaches the chamber", async () => {
    await loadChamber(makeFakeChamberModule("parked"), { envFor: () => ({}) });
    detachChamber("parked");
    const res = await app.request("/api/parked/notes", { headers: session() }, bindings());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "chamber_offline", chamber: "parked" });
  });
});

describe("chamber paths", () => {
  it("falls through to Congress's own frontend for a chamber navigation path", async () => {
    // Hard-loading "/e2e/n/1" must reach the shell, which mounts the Chamber.
    const res = await app.request("/e2e/n/1", {}, bindings());
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it("does not shadow Congress's own routes for an unknown first path segment", async () => {
    const res = await app.request("/some-unregistered-path", {}, bindings());
    expect(res.status).not.toBe(503);
  });
});

describe("POST /api/fitness/health/ingest", () => {
  // The one deliberate exception to "every /api/:chamber/* request needs a
  // session" - an iOS Shortcuts automation can't present a session cookie.
  // The secret check happens entirely inside chamber-fitness's own handler.
  it("404s if chamber-fitness isn't loaded", async () => {
    const res = await app.request("/api/fitness/health/ingest", { method: "POST", headers: json, body: "{}" }, bindings());
    expect(res.status).toBe(404);
  });

  it("dispatches with no session required, passing the caller's token header through unmodified", async () => {
    await loadChamber(
      makeFakeChamberModule("fitness", {
        configure: (c) =>
          c.post("/api/health/ingest", async (ctx) =>
            ctx.json({ receivedToken: ctx.req.header("x-health-ingest-token") ?? null, actor: ctx.req.header("x-congress-actor") ?? null, body: await ctx.req.json() })
          ),
      }),
      { envFor: () => ({}) }
    );

    const res = await app.request(
      "/api/fitness/health/ingest",
      { method: "POST", headers: { ...json, "X-Health-Ingest-Token": "owner-secret" }, body: JSON.stringify({ samples: [] }) },
      bindings()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ receivedToken: "owner-secret", actor: "system", body: { samples: [] } });
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

  it("gates a chamber's /mcp/<name> with the shared secret", async () => {
    expect((await fetch(`${origin}/mcp/tooled`, { method: "POST", headers: json, body: "{}" })).status).toBe(401);
  });

  it("serves exactly that chamber's tools at /mcp/<name>", async () => {
    const tools = await listChamberTools(`${origin}/mcp/tooled`, TEST_INTERNAL_TOKEN);
    expect(tools.map((t) => t.name)).toEqual(["ping"]);
  });

  it("404s an unknown chamber's mcp path instead of falling through to Congress's own", async () => {
    const res = await fetch(`${origin}/mcp/nosuch`, { method: "POST", headers: { ...internal, ...json }, body: "{}" });
    expect(res.status).toBe(404);
  });
});
