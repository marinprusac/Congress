import { beforeAll, describe, expect, it } from "vitest";
import { makeFakeChamberModule, makeManifest, migrationsDir, type FakeChamberModule } from "@congress/test-support";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { runMigrations } from "./db/client.js";
import { loadChamber } from "./chambers/loader.js";
import { DEFAULT_VIEW_SCORE, getFeed, rankFeed } from "./feed.js";

function entry(name: string, views: ChamberRegistryEntry["views"]): ChamberRegistryEntry {
  return {
    ...makeManifest(name),
    views,
    status: "active",
    registeredAt: new Date().toISOString(),
    subscriptions: [],
  };
}

describe("rankFeed", () => {
  it("sorts every Chamber's candidates together by score", () => {
    const ranked = rankFeed([
      { chamber: entry("map", [{ id: "today", label: "Today", card: true }]), candidates: [{ kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue" }] },
      { chamber: entry("fitness", [{ id: "health", label: "Health", fullPath: "/metrics", card: true }]), candidates: [{ kind: "view", viewId: "health", score: 95, reason: "New reading" }] },
    ]);

    expect(ranked.map((i) => (i.kind === "view" ? `${i.chamber}:${i.viewId}` : i.exhibitId))).toEqual(["fitness:health", "task-1", "map:today"]);
    expect(ranked[0]).toMatchObject({ label: "Health", fullPath: "/metrics", reason: "New reading" });
  });

  it("gives an unscored carded view the default score", () => {
    const ranked = rankFeed([{ chamber: entry("map", [{ id: "today", label: "Today", card: true }]), candidates: [] }]);
    expect(ranked).toEqual([{ kind: "view", chamber: "map", viewId: "today", label: "Today", fullPath: undefined, score: DEFAULT_VIEW_SCORE, reason: undefined }]);
  });

  it("leaves card-less views out entirely - a feed item has to show something, not just link somewhere", () => {
    const ranked = rankFeed([
      { chamber: entry("calendar", [{ id: "agenda", label: "Agenda", fullPath: "/" }]), candidates: [{ kind: "view", viewId: "agenda", score: 90, reason: "Your day" }] },
    ]);
    expect(ranked).toEqual([]);
  });

  it("carries an exhibit's inline preview through", () => {
    const preview = { time: { label: "Due", start: "2026-09-27T15:00:00.000Z" }, body: "Invoice #42 for September" };
    const ranked = rankFeed([{ chamber: entry("tasks", []), candidates: [{ kind: "exhibit", exhibitId: "task-1", score: 80, preview }] }]);
    expect(ranked[0]).toMatchObject({ exhibitId: "task-1", preview });
  });

  it("drops a candidate naming a view the Chamber never declared", () => {
    const ranked = rankFeed([{ chamber: entry("notes", []), candidates: [{ kind: "view", viewId: "ghost", score: 99 }] }]);
    expect(ranked).toEqual([]);
  });

  it("keeps an exhibit named twice once, at its best score", () => {
    const ranked = rankFeed([
      {
        chamber: entry("tasks", []),
        candidates: [
          { kind: "exhibit", exhibitId: "task-1", score: 40, reason: "Due tomorrow" },
          { kind: "exhibit", exhibitId: "task-1", score: 80, reason: "Due in 1h" },
        ],
      },
    ]);
    expect(ranked).toEqual([{ kind: "exhibit", chamber: "tasks", exhibitId: "task-1", score: 80, reason: "Due in 1h" }]);
  });
});

describe("getFeed", () => {
  async function load(name: string, views: ChamberRegistryEntry["views"], configure: (app: FakeChamberModule["app"]) => void) {
    await loadChamber(makeFakeChamberModule(name, { manifest: { views }, configure }), { envFor: () => ({}) });
  }

  beforeAll(async () => {
    runMigrations(migrationsDir("congress"));

    await load("tasks", [{ id: "open", label: "Open tasks", card: true }], (app) => {
      app.get("/api/feed", (c) =>
        c.json({
          items: [
            { kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue", preview: { body: "Invoice #42" } },
            { kind: "exhibit", exhibitId: "task-2", score: 80, reason: "Due in 1h" },
            { kind: "view", viewId: "open", score: 60 },
          ],
        })
      );
      app.post("/api/exhibits/resolve", async (c) => {
        const { ids } = (await c.req.json()) as { ids: string[] };
        return c.json({
          results: ids.map((id) => (id === "task-2" ? { id, deleted: true } : { id, name: `Task ${id}`, url: `/t/${id.slice(5)}` })),
        });
      });
    });
    await load("slow", [{ id: "late", label: "Late", card: true }], (app) => {
      app.get("/api/feed", async (c) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return c.json({ items: [{ kind: "view", viewId: "late", score: 99 }] });
      });
    });
    await load("broken", [{ id: "b", label: "Broken view", card: true }], (app) => {
      app.get("/api/feed", (c) => c.json({ nonsense: true }));
    });
  });

  it("merges live candidates, resolves exhibits, and drops ones that no longer resolve", async () => {
    const items = await getFeed({ timeoutMs: 200 });

    expect(items[0]).toEqual({ kind: "exhibit", chamber: "tasks", exhibitId: "task-1", name: "Task task-1", url: "/t/1", score: 90, reason: "Overdue", preview: { body: "Invoice #42" } });
    expect(items.some((i) => i.kind === "exhibit" && i.exhibitId === "task-2")).toBe(false);
    expect(items.find((i) => i.kind === "view" && i.viewId === "open")?.score).toBe(60);
  });

  it("doesn't wait on a slow Chamber or trust a malformed one - their views just fall back to the default score", async () => {
    const started = Date.now();
    const items = await getFeed({ timeoutMs: 200 });

    expect(Date.now() - started).toBeLessThan(450);
    expect(items.find((i) => i.kind === "view" && i.viewId === "late")?.score).toBe(DEFAULT_VIEW_SCORE);
    expect(items.find((i) => i.kind === "view" && i.viewId === "b")?.score).toBe(DEFAULT_VIEW_SCORE);
  });
});
