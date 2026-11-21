import { describe, expect, it } from "vitest";
import { rankFeed } from "./feed.js";

const entry = (name: string) => ({ name });

describe("rankFeed", () => {
  it("sorts every source's candidates together by score", () => {
    const ranked = rankFeed([
      { chamber: entry("map"), candidates: [{ kind: "record", recordId: "task-1", score: 90, reason: "Overdue" }] },
      { chamber: entry("fitness"), candidates: [{ kind: "record", recordId: "workout-1", score: 95, reason: "New" }] },
    ]);
    expect(ranked.map((i) => i.recordId)).toEqual(["workout-1", "task-1"]);
  });

  it("carries a record's inline preview through", () => {
    const preview = { time: { label: "Due", start: "2026-09-27T15:00:00.000Z" }, body: "Invoice #42 for September" };
    const ranked = rankFeed([{ chamber: entry("tasks"), candidates: [{ kind: "record", recordId: "task-1", score: 80, preview }] }]);
    expect(ranked[0]).toMatchObject({ recordId: "task-1", preview });
  });

  it("keeps a record named twice once, at its best score", () => {
    const ranked = rankFeed([
      {
        chamber: entry("tasks"),
        candidates: [
          { kind: "record", recordId: "task-1", score: 40, reason: "Due tomorrow" },
          { kind: "record", recordId: "task-1", score: 80, reason: "Due in 1h" },
        ],
      },
    ]);
    expect(ranked).toEqual([{ kind: "record", chamber: "tasks", recordId: "task-1", score: 80, reason: "Due in 1h" }]);
  });
});
