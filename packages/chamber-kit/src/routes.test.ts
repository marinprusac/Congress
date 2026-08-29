import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  mountExhibitSearchRoutes,
  mountManifestAndHealth,
  mountManualRefsRoutes,
  mountSettingsRoutes,
  mountStaticFrontend,
} from "./routes.js";
import type { ExhibitResolveResult, ExhibitSearchResult, Manifest } from "@congress/shared-types";

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
    apiBase: "http://127.0.0.1:8011/api",
    healthUrl: "http://127.0.0.1:8011/health",
  } as unknown as Manifest;

  it("serves the manifest verbatim", async () => {
    const app = newApp();
    mountManifestAndHealth(app, manifest);
    const res = await app.request("/manifest");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ name: "notes", apiBase: manifest.apiBase });
  });

  it("answers the heartbeat sweep's liveness probe", async () => {
    const app = newApp();
    mountManifestAndHealth(app, manifest);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("mountExhibitSearchRoutes", () => {
  function mount(overrides: Partial<Parameters<typeof mountExhibitSearchRoutes>[1]> = {}) {
    const search = vi.fn<(q: string, limit?: number) => Promise<ExhibitSearchResult[]>>().mockResolvedValue([]);
    const resolve = vi.fn<(ids: string[]) => Promise<ExhibitResolveResult[]>>().mockResolvedValue([]);
    const chip = vi
      .fn<(rawId: number) => Promise<{ id: string; name: string; url: string } | { id: string; deleted: true }>>()
      .mockResolvedValue({ id: "note-1", name: "One", url: "/n/1" });
    const app = newApp();
    mountExhibitSearchRoutes(app, { search, resolve, chip, ...overrides });
    return { app, search, resolve, chip };
  }

  it("passes the query and limit through and wraps results in a results envelope", async () => {
    const { app, search } = mount();
    const res = await app.request("/api/exhibits/search?q=week&limit=3");
    expect(search).toHaveBeenCalledWith("week", 3);
    await expect(res.json()).resolves.toEqual({ results: [] });
  });

  it("treats a missing query as an empty one rather than an error", async () => {
    // An empty query is meaningful: it asks the Chamber for its most recent
    // Exhibits, which is what the "[[" picker shows before anything is typed.
    const { app, search } = mount();
    await app.request("/api/exhibits/search");
    expect(search).toHaveBeenCalledWith("", undefined);
  });

  it("rejects a malformed resolve body with 400 instead of calling through", async () => {
    const { app, resolve } = mount();
    const res = await app.request("/api/exhibits/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notIds: true }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON resolve body with 400 rather than throwing", async () => {
    const { app } = mount();
    const res = await app.request("/api/exhibits/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("answers 404 not_supported when the Chamber has no chip implementation", async () => {
    // Calendar's compound ids have no raw row id, so it omits chip() - that
    // has to read as "this Chamber can't do this", not as a crash.
    const { app } = mount({ chip: undefined });
    const res = await app.request("/api/exhibits/chip/1");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_supported" });
  });

  it("rejects a non-integer raw id with 400", async () => {
    const { app, chip } = mount();
    const res = await app.request("/api/exhibits/chip/abc");
    expect(res.status).toBe(400);
    expect(chip).not.toHaveBeenCalled();
  });

  it("turns a deleted chip result into a 404", async () => {
    const chip = vi.fn().mockResolvedValue({ id: "note-9", deleted: true });
    const { app } = mount({ chip });
    const res = await app.request("/api/exhibits/chip/9");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns the chip payload for a live row", async () => {
    const { app } = mount();
    const res = await app.request("/api/exhibits/chip/1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "note-1", name: "One", url: "/n/1" });
  });
});

describe("mountSettingsRoutes", () => {
  const schema = {
    safeParse: (input: unknown) =>
      input && typeof input === "object" && !Array.isArray(input)
        ? { success: true, data: input as { darkMode?: boolean } }
        : { success: false, error: { flatten: () => ({}) } },
  };

  it("returns current settings", async () => {
    const app = newApp();
    mountSettingsRoutes(app, {
      getSettings: async () => ({ darkMode: true }),
      updateSettings: async (i) => ({ darkMode: true, ...i }),
    }, schema);
    await expect((await app.request("/api/settings")).json()).resolves.toEqual({ darkMode: true });
  });

  it("rejects an invalid update body with 400 and does not write", async () => {
    const updateSettings = vi.fn();
    const app = newApp();
    mountSettingsRoutes(app, { getSettings: async () => ({}), updateSettings }, schema);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });
    expect(res.status).toBe(400);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("passes a valid update through and returns the written settings", async () => {
    const app = newApp();
    mountSettingsRoutes(app, {
      getSettings: async () => ({ darkMode: false }),
      updateSettings: async (i) => ({ darkMode: false, ...i }),
    }, schema);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ darkMode: true }),
    });
    await expect(res.json()).resolves.toEqual({ darkMode: true });
  });
});

describe("mountManualRefsRoutes", () => {
  function mount() {
    const store = new Map<string, string[]>([["note-1", ["task-2"]]]);
    const onChange = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const app = newApp();
    mountManualRefsRoutes(
      app,
      {
        list: (id) => store.get(id) ?? null,
        add: (id, target) => {
          const refs = store.get(id);
          if (!refs) return false;
          if (!refs.includes(target)) refs.push(target);
          return true;
        },
        remove: (id, target) => {
          const refs = store.get(id);
          if (!refs?.includes(target)) return false;
          refs.splice(refs.indexOf(target), 1);
          return true;
        },
      },
      onChange
    );
    return { app, onChange };
  }

  it("lists refs for an owned exhibit", async () => {
    const { app } = mount();
    await expect((await app.request("/api/exhibits/note-1/refs")).json()).resolves.toEqual({ refs: ["task-2"] });
  });

  it("404s for an exhibit this Chamber does not own", async () => {
    const { app } = mount();
    expect((await app.request("/api/exhibits/note-999/refs")).status).toBe(404);
  });

  it("adds a ref and notifies the owner so it can resync its exhibit", async () => {
    const { app, onChange } = mount();
    const res = await app.request("/api/exhibits/note-1/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetExhibitId: "doc-5" }),
    });
    await expect(res.json()).resolves.toEqual({ refs: ["task-2", "doc-5"] });
    expect(onChange).toHaveBeenCalledWith("note-1");
  });

  it("rejects a malformed add body with 400 and does not notify", async () => {
    const { app, onChange } = mount();
    const res = await app.request("/api/exhibits/note-1/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a ref and notifies", async () => {
    const { app, onChange } = mount();
    const res = await app.request("/api/exhibits/note-1/refs/task-2", { method: "DELETE" });
    await expect(res.json()).resolves.toEqual({ refs: [] });
    expect(onChange).toHaveBeenCalledWith("note-1");
  });

  it("404s removing a ref that is not there, without notifying", async () => {
    const { app, onChange } = mount();
    const res = await app.request("/api/exhibits/note-1/refs/nope-1", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(onChange).not.toHaveBeenCalled();
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
