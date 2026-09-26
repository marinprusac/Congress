import { describe, expect, it } from "vitest";
import type { TaskSummary } from "./types.js";
import { taskFeedCandidates } from "./feedRules.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function task(id: number, dueInMs: number | null): TaskSummary {
  return {
    id,
    name: `Task ${id}`,
    description: "",
    dueDate: dueInMs === null ? null : new Date(now.getTime() + dueInMs).toISOString(),
    completed: false,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("taskFeedCandidates", () => {
  it("puts an overdue task near the top of the feed", () => {
    const items = taskFeedCandidates([task(1, -2 * HOUR)], now);
    expect(items).toContainEqual({ kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue by 2 h" });
    expect(items).toContainEqual({ kind: "view", viewId: "open", score: 70, reason: "1 overdue" });
  });

  it("ranks a task due sooner above one due later, both within a day", () => {
    const items = taskFeedCandidates([task(1, 20 * HOUR), task(2, HOUR)], now);
    const score = (id: string) => items.find((i) => i.kind === "exhibit" && i.exhibitId === id)!.score;
    expect(score("task-2")).toBeGreaterThan(score("task-1"));
    expect(items.find((i) => i.kind === "exhibit" && i.exhibitId === "task-2")!.reason).toBe("Due in 1 h");
  });

  it("leaves tasks due later than a day, or with no due date, out of the feed", () => {
    const items = taskFeedCandidates([task(1, 3 * 24 * HOUR), task(2, null)], now);
    expect(items.filter((i) => i.kind === "exhibit")).toEqual([]);
    expect(items).toContainEqual({ kind: "view", viewId: "open", score: 20, reason: undefined });
  });

  it("sinks the Open card when there's nothing open", () => {
    expect(taskFeedCandidates([], now)).toEqual([{ kind: "view", viewId: "open", score: 5, reason: undefined }]);
  });
});
