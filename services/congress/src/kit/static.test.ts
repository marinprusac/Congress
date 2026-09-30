import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "@congress/shared-types";
import { mountManifestAndHealth, mountStaticFrontend } from "./static.js";

function newApp() {
  return new Hono<{ Bindings: HttpBindings }>();
}

describe("mountManifestAndHealth", () => {
  const manifest = {
    name: "notes",
    displayName: "Notes",
    version: "0.1.0",
    routes: [],
    widgets: [],
    events: [],
  } as unknown as Manifest;

  it("serves the manifest verbatim", async () => {
    const app = newApp();
    mountManifestAndHealth(app, manifest);
    const res = await app.request("/manifest");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ name: "notes" });
  });

  it("answers a liveness probe", async () => {
    const app = newApp();
    mountManifestAndHealth(app, manifest);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("mountStaticFrontend", () => {
  // serveStatic resolves its roots against the process cwd, so the fixture
  // has to be the cwd for the duration of this block.
  const originalCwd = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), "congress-static-"));
  const app = newApp();

  beforeAll(() => {
    mkdirSync(join(fixture, "frontend", "dist", "assets"), { recursive: true });
    writeFileSync(join(fixture, "frontend", "dist", "index.html"), "<html>shell</html>");
    writeFileSync(join(fixture, "frontend", "dist", "assets", "app-abc123.js"), "console.log(1)");
    writeFileSync(join(fixture, "frontend", "dist", "remote-entry.js"), "export {};");
    process.chdir(fixture);
    mountStaticFrontend(app);
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  it("404s a missing asset request instead of silently serving the SPA shell", async () => {
    // The regression this guards: a build step that never ran (a skipped
    // build:vendor) used to return index.html with a 200 under a .js URL,
    // which fails ES module parsing with no console error and no failing
    // network request pointing at the cause - a blank shell and no clue.
    const res = await app.request("/vendor/react-query.js");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("shell");
  });

  it("falls back to the SPA shell for a navigation-shaped path", async () => {
    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });

  it("falls back to the SPA shell for a nested navigation path", async () => {
    const res = await app.request("/notes/n42");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });

  it("falls back to the SPA shell for a navigation path whose last segment contains a dot", async () => {
    // Regression: chamber-logs' /events/:eventType route (e.g.
    // "tasks.due_soon") used to 404 on reload because the fallback treated
    // any dot in the last segment as a static-asset request.
    const res = await app.request("/events/tasks.due_soon");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });

  it("caches content-hashed assets for a year", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("caches the deliberately unhashed entry files only briefly, so a redeploy is visible", async () => {
    const res = await app.request("/remote-entry.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
  });
});
