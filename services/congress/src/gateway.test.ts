import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir, startFakeChamber, type FakeChamber } from "@congress/test-support";
import { runMigrations } from "./db/client.js";
import { detachChamber, registerChamber } from "./registry.js";
import {
  forwardToChamber,
  forwardToChamberFrontend,
  frontendBaseOf,
  proxyToChamberIcon,
  rewriteChamberPath,
  timeoutFor,
} from "./gateway.js";
import { getChamber } from "./registry.js";

describe("frontendBaseOf", () => {
  it("strips the trailing /api a manifest's apiBase always carries", () => {
    expect(frontendBaseOf("http://127.0.0.1:8011/api")).toBe("http://127.0.0.1:8011");
  });

  it("only strips a trailing /api, not one in the middle of the path", () => {
    expect(frontendBaseOf("http://host/api/v2")).toBe("http://host/api/v2");
  });

  it("leaves a base with no /api suffix alone", () => {
    expect(frontendBaseOf("http://127.0.0.1:8011")).toBe("http://127.0.0.1:8011");
  });
});

describe("rewriteChamberPath", () => {
  it("strips the route prefix and re-attaches the query string", () => {
    expect(rewriteChamberPath("/api/notes/notes/3", "/api/notes", "http://up/api", "?q=1")).toBe("http://up/api/notes/3?q=1");
  });

  it("produces an empty remainder for a bare prefix by default", () => {
    expect(rewriteChamberPath("/api/notes", "/api/notes", "http://up/api", "")).toBe("http://up/api");
  });

  it("uses the fallback for a bare prefix when one is given, as the frontend proxy needs", () => {
    // "/notes" has to reach the Chamber as "/", not as the empty path, or
    // its SPA shell is never served.
    expect(rewriteChamberPath("/notes", "/notes", "http://up", "", "/")).toBe("http://up/");
  });

  it("keeps a nested asset path intact", () => {
    expect(rewriteChamberPath("/notes/assets/app-abc.js", "/notes", "http://up", "", "/")).toBe(
      "http://up/assets/app-abc.js"
    );
  });
});

describe("timeoutFor", () => {
  it("gives Deputy's chat POST minutes, because it blocks on a full headless run", () => {
    expect(timeoutFor("deputy", "POST", "/chat/messages")).toBe(5 * 60 * 1000);
  });

  it("gives every other Deputy route the ordinary timeout", () => {
    expect(timeoutFor("deputy", "GET", "/chat/messages")).toBe(10_000);
    expect(timeoutFor("deputy", "POST", "/directives")).toBe(10_000);
  });

  it("gives another chamber's identically-named route the ordinary timeout", () => {
    expect(timeoutFor("notes", "POST", "/chat/messages")).toBe(10_000);
  });
});

describe("proxying", () => {
  let upstream: FakeChamber;
  const app = new Hono<{ Bindings: HttpBindings }>();

  beforeAll(async () => {
    runMigrations(migrationsDir("congress"));

    upstream = await startFakeChamber((chamber) => {
      chamber.get("/api/echo", (c) => c.json({ path: c.req.path, query: c.req.query("q") ?? null }));
      chamber.post("/api/echo", async (c) => c.json({ body: await c.req.json() }));
      chamber.get("/api/gzipped", (c) => {
        // A Chamber's own static serving returns pre-compressed responses
        // (see chamber-kit routes.ts's `precompressed: true`), which is what
        // made the header handling below matter.
        const body = gzipSync(Buffer.from("compressible ".repeat(50)));
        return new Response(body, {
          headers: { "content-encoding": "gzip", "content-length": String(body.length), "content-type": "text/plain" },
        });
      });
      chamber.get("/icons/mark.svg", (c) => c.body("<svg/>", 200, { "content-type": "image/svg+xml" }));
      chamber.get("/", (c) => c.html("<html>shell</html>"));
      chamber.get("/assets/app.js", (c) => c.body("console.log(1)", 200, { "content-type": "text/javascript" }));
    });

    registerChamber(makeManifest("upstream", upstream.origin));
    registerChamber(makeManifest("gone", "http://127.0.0.1:19099"));
    registerChamber(makeManifest("parked", upstream.origin));
    detachChamber("parked");

    app.all("/api/:chamber/*", forwardToChamber);
    app.get("/congress/chambers/:name/icon", (c) => proxyToChamberIcon(c, c.req.param("name")));
    app.all("/:chamberName/*", (c) => {
      const chamber = getChamber(c.req.param("chamberName") ?? "");
      if (!chamber) return c.json({ error: "chamber_not_found" }, 503);
      return forwardToChamberFrontend(c, chamber);
    });
    app.all("/:chamberName", (c) => {
      const chamber = getChamber(c.req.param("chamberName") ?? "");
      if (!chamber) return c.json({ error: "chamber_not_found" }, 503);
      return forwardToChamberFrontend(c, chamber);
    });
  });

  afterAll(async () => {
    await upstream.close();
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

    it("does not forward hop-by-hop headers, including the caller's Host", async () => {
      // The Chamber has to be addressed by its own host, not the public one
      // the browser used, and a proxy-scoped credential must not leak past
      // the hop it was meant for. (`connection` is not asserted on: the
      // caller's is dropped, but undici sets its own on the outgoing
      // request, so the upstream legitimately still sees one.)
      await app.request("/api/upstream/echo", {
        headers: { host: "congress.example.com", "proxy-authorization": "Bearer leaked", te: "trailers" },
      });
      const seen = upstream.received.at(-1)!.headers;
      expect(seen.host).not.toBe("congress.example.com");
      expect(seen["proxy-authorization"]).toBeUndefined();
      expect(seen.te).toBeUndefined();
    });

    it("passes ordinary headers through", async () => {
      await app.request("/api/upstream/echo", { headers: { "x-custom": "kept" } });
      expect(upstream.received.at(-1)!.headers["x-custom"]).toBe("kept");
    });

    it("hands back a decoded body without the stale content-encoding and content-length", async () => {
      // fetch() decompresses transparently but leaves those two headers
      // describing the wire response. Relaying them alongside the decoded
      // body is what produced ERR_CONTENT_DECODING_FAILED in the browser.
      const res = await app.request("/api/upstream/gzipped");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("content-length")).toBeNull();
      expect(await res.text()).toBe("compressible ".repeat(50));
    });

    it("503s an unregistered chamber", async () => {
      const res = await app.request("/api/nosuch/echo");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_not_found", chamber: "nosuch" });
    });

    it("503s a chamber the owner has detached, even though it is registered", async () => {
      const res = await app.request("/api/parked/echo");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_offline", chamber: "parked" });
    });

    it("503s a registered chamber whose process is not answering", async () => {
      const res = await app.request("/api/gone/echo");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_unreachable", chamber: "gone" });
    });
  });

  describe("forwardToChamberFrontend", () => {
    it("serves the chamber's SPA shell at its bare path", async () => {
      const res = await app.request("/upstream");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("shell");
    });

    it("proxies a nested asset off the origin, not off /api", async () => {
      const res = await app.request("/upstream/assets/app.js");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("console.log(1)");
    });

    it("503s a detached chamber", async () => {
      const res = await app.request("/parked/assets/app.js");
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toEqual({ error: "chamber_offline", chamber: "parked" });
    });
  });

  describe("proxyToChamberIcon", () => {
    it("serves the chamber's own mark from its public assets", async () => {
      const res = await app.request("/congress/chambers/upstream/icon");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<svg/>");
    });

    it("404s rather than 503s for an unknown chamber, so callers fall back to a generic mark", async () => {
      expect((await app.request("/congress/chambers/nosuch/icon")).status).toBe(404);
    });

    it("404s for a detached chamber", async () => {
      expect((await app.request("/congress/chambers/parked/icon")).status).toBe(404);
    });

    it("404s when the chamber's process is unreachable", async () => {
      expect((await app.request("/congress/chambers/gone/icon")).status).toBe(404);
    });
  });
});
