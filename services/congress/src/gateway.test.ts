import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeFakeChamberModule, migrationsDir, type FakeChamberModule } from "@congress/test-support";

vi.mock("./sessionAuth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessionAuth.js")>()),
  hasValidSession: async () => true,
}));

import { runMigrations } from "./db/client.js";
import { detachChamber } from "./registry.js";
import { loadChamber } from "./chambers/loader.js";
import { dispatchToChamber, forwardToChamber, serveChamberAssets, serveChamberIcon, stripPrefix } from "./gateway.js";

describe("stripPrefix", () => {
  it("keeps the remainder after a fixed prefix", () => {
    expect(stripPrefix("/api/notes/notes/3", "/api/notes")).toBe("/notes/3");
    expect(stripPrefix("/api/notes", "/api/notes")).toBe("");
  });
});

describe("gateway", () => {
  let upstream: FakeChamberModule;
  const app = new Hono<{ Bindings: HttpBindings }>();

  beforeAll(async () => {
    runMigrations(migrationsDir("congress"));

    const dir = mkdtempSync(join(tmpdir(), "congress-gateway-"));
    mkdirSync(join(dir, "frontend/dist/icons"), { recursive: true });
    mkdirSync(join(dir, "frontend/dist/assets"), { recursive: true });
    writeFileSync(join(dir, "frontend/dist/icons/mark.svg"), "<svg/>");
    writeFileSync(join(dir, "frontend/dist/remote-entry.js"), "export default 1;");
    writeFileSync(join(dir, "frontend/dist/assets/app-abc.js"), "console.log(1)");
    writeFileSync(join(dir, "frontend/dist/index.html"), "<html>standalone</html>");

    upstream = makeFakeChamberModule("upstream", {
      dir,
      configure: (chamber) => {
        chamber.get("/api/echo", (c) => c.json({ path: c.req.path, query: c.req.query("q") ?? null }));
        chamber.post("/api/echo", async (c) => c.json({ body: await c.req.json() }));
        chamber.get("/api/redirect", (c) => c.redirect("https://accounts.example.com/auth"));
      },
    });
    await loadChamber(upstream, { envFor: () => ({}) });
    await loadChamber(makeFakeChamberModule("parked", { dir }), { envFor: () => ({}) });
    detachChamber("parked");
    await loadChamber(
      makeFakeChamberModule("broken", {
        start: () => {
          throw new Error("no config");
        },
      }),
      { envFor: () => ({}) }
    );

    app.all("/api/:chamber/*", forwardToChamber);
    app.post("/device/:chamber", (c) => dispatchToChamber(c, c.req.param("chamber"), "/echo", "system"));
    app.get("/congress/chambers/:name/icon", (c) => serveChamberIcon(c, c.req.param("name")));
    app.get("/:chamberName/*", serveChamberAssets);
    app.get("*", (c) => c.text("congress shell"));
  });

  describe("forwardToChamber", () => {
    it("strips the /api/<chamber> prefix and preserves the query string", async () => {
      const res = await app.request("/api/upstream/echo?q=hello");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ path: "/api/echo", query: "hello" });
    });

    it("forwards a request body", async () => {
      const res = await app.request("/api/upstream/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      await expect(res.json()).resolves.toEqual({ body: { hello: "world" } });
    });

    it("attributes the request to the owner, discarding any actor the client claimed", async () => {
      await app.request("/api/upstream/echo", { headers: { "x-congress-actor": "deputy" } });
      expect(upstream.received.at(-1)!.headers["x-congress-actor"]).toBe("me");
    });

    it("passes ordinary headers through", async () => {
      await app.request("/api/upstream/echo", { headers: { "x-custom": "kept" } });
      expect(upstream.received.at(-1)!.headers["x-custom"]).toBe("kept");
    });

    it("relays a Chamber's redirect as-is instead of following it", async () => {
      const res = await app.request("/api/upstream/redirect");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://accounts.example.com/auth");
    });

    it("404s an unknown chamber", async () => {
      const res = await app.request("/api/nosuch/echo");
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "chamber_not_found", chamber: "nosuch" });
    });

    it("503s a chamber the owner has detached", async () => {
      const res = await app.request("/api/parked/echo");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_offline", chamber: "parked" });
    });

    it("503s a chamber that failed to start", async () => {
      const res = await app.request("/api/broken/echo");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_offline", chamber: "broken" });
    });
  });

  describe("dispatchToChamber", () => {
    it("attributes an unauthenticated caller to the actor it is given, not the client's claim", async () => {
      await app.request("/device/upstream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-congress-actor": "me" },
        body: "{}",
      });
      expect(upstream.received.at(-1)!.headers["x-congress-actor"]).toBe("system");
    });
  });

  describe("serveChamberAssets", () => {
    it("serves a built asset from the chamber's own dist, with a short cache on the unhashed entry", async () => {
      const res = await app.request("/upstream/remote-entry.js");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("export default 1;");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
    });

    it("caches content-hashed assets for a year", async () => {
      const res = await app.request("/upstream/assets/app-abc.js");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    });

    it("leaves navigation paths and the standalone index.html to Congress's shell", async () => {
      expect(await (await app.request("/upstream/n/3")).text()).toBe("congress shell");
      expect(await (await app.request("/upstream/index.html")).text()).toBe("congress shell");
    });

    it("does not serve a detached chamber's assets", async () => {
      expect(await (await app.request("/parked/remote-entry.js")).text()).toBe("congress shell");
    });
  });

  describe("serveChamberIcon", () => {
    it("serves the chamber's own mark", async () => {
      const res = await app.request("/congress/chambers/upstream/icon");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(await res.text()).toBe("<svg/>");
    });

    it("404s for an unknown, detached or failed chamber, so callers fall back to a generic mark", async () => {
      expect((await app.request("/congress/chambers/nosuch/icon")).status).toBe(404);
      expect((await app.request("/congress/chambers/parked/icon")).status).toBe(404);
      expect((await app.request("/congress/chambers/broken/icon")).status).toBe(404);
    });
  });
});
