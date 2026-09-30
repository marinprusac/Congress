import { describe, expect, it } from "vitest";
import type { ManifestView } from "@congress/shared-types";
import { DEFAULT_VIEW_SCORE, rankFeed } from "./feed.js";

const entry = (name: string, views: ManifestView[]) => ({ name, views });

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
