import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir, startFakeChamber, type FakeChamber } from "@congress/test-support";
import type { ChamberRegistryEntry } from "@congress/shared-types";
import { runMigrations } from "./db/client.js";
import { registerChamber } from "./registry.js";
import { DEFAULT_VIEW_SCORE, getFeed, rankFeed } from "./feed.js";

function entry(name: string, views: ChamberRegistryEntry["views"]): ChamberRegistryEntry {
  return {
    ...makeManifest(name),
    views,
    status: "active",
    registeredAt: new Date().toISOString(),
    lastHeartbeatAt: null,
    subscriptions: [],
  };
}

describe("rankFeed", () => {
  it("sorts every Chamber's candidates together by score", () => {
    const ranked = rankFeed([
      { chamber: entry("tasks", [{ id: "open", label: "Open" }]), candidates: [{ kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue" }] },
      { chamber: entry("calendar", [{ id: "upcoming", label: "Upcoming", fullPath: "/" }]), candidates: [{ kind: "view", viewId: "upcoming", score: 95, reason: "Starts in 10 min" }] },
    ]);

    expect(ranked.map((i) => (i.kind === "view" ? `${i.chamber}:${i.viewId}` : i.exhibitId))).toEqual(["calendar:upcoming", "task-1", "tasks:open"]);
    expect(ranked[0]).toMatchObject({ label: "Upcoming", fullPath: "/", reason: "Starts in 10 min" });
  });

  it("gives an unscored declared view the default score, so every view stays reachable", () => {
    const ranked = rankFeed([{ chamber: entry("notes", [{ id: "pinned", label: "Pinned" }]), candidates: [] }]);
    expect(ranked).toEqual([{ kind: "view", chamber: "notes", viewId: "pinned", label: "Pinned", fullPath: undefined, score: DEFAULT_VIEW_SCORE, reason: undefined }]);
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
  let tasks: FakeChamber;
  let slow: FakeChamber;
  let broken: FakeChamber;

  beforeAll(async () => {
    runMigrations(migrationsDir("congress"));

    tasks = await startFakeChamber((app) => {
      app.get("/api/feed", (c) =>
        c.json({
          items: [
            { kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue" },
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
    slow = await startFakeChamber((app) => {
      app.get("/api/feed", async (c) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return c.json({ items: [{ kind: "view", viewId: "late", score: 99 }] });
      });
    });
    broken = await startFakeChamber((app) => {
      app.get("/api/feed", (c) => c.json({ nonsense: true }));
    });

    registerChamber(makeManifest("tasks", tasks.origin, { views: [{ id: "open", label: "Open tasks" }] }));
    registerChamber(makeManifest("slow", slow.origin, { views: [{ id: "late", label: "Late" }] }));
    registerChamber(makeManifest("broken", broken.origin, { views: [{ id: "b", label: "Broken view" }] }));
  });

  afterAll(async () => {
    await Promise.all([tasks.close(), slow.close(), broken.close()]);
  });

  it("merges live candidates, resolves exhibits, and drops ones that no longer resolve", async () => {
    const items = await getFeed({ timeoutMs: 200 });

    expect(items[0]).toEqual({ kind: "exhibit", chamber: "tasks", exhibitId: "task-1", name: "Task task-1", url: "/t/1", score: 90, reason: "Overdue" });
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
