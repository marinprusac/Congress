import { describe, expect, it } from "vitest";
import type { TaskSummary } from "./types.js";
import { taskFeedCandidates } from "./feedRules.js";

// Midday 27 September in Zagreb (CEST, +02:00).
const TZ = "Europe/Zagreb";
const HOUR = 60 * 60 * 1000;
const midnight = (day: number) => new Date(Date.UTC(2026, 8, 27 + day) - 2 * HOUR);
const now = new Date(midnight(0).getTime() + 12 * HOUR);

// Due `dueDay` days from today, stored as that day's local midnight.
function task(id: number, dueDay: number | null): TaskSummary {
  return {
    id,
    name: `Task ${id}`,
    description: "",
    dueDate: dueDay === null ? null : midnight(dueDay).toISOString(),
    completed: false,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("taskFeedCandidates", () => {
  it("puts a task whose due day has ended near the top of the feed", () => {
    expect(taskFeedCandidates([task(1, -1)], now, TZ)).toMatchObject([{ kind: "exhibit", exhibitId: "task-1", score: 90, reason: "Overdue" }]);
  });

  it("keeps a task due today as due, not overdue, until the day ends", () => {
    const [item] = taskFeedCandidates([task(1, 0)], new Date(midnight(1).getTime() - 1), TZ);
    expect(item).toMatchObject({ exhibitId: "task-1" });
    expect(item?.reason).toBeUndefined();
    expect(taskFeedCandidates([task(1, 0)], midnight(1), TZ)).toMatchObject([{ reason: "Overdue" }]);
  });

  it("shows the due day (no clock time) and the description inline", () => {
    const t = { ...task(1, 0), description: "Invoice #42 for [[exhibit:documents:document-3|September hours]]" };
    const [item] = taskFeedCandidates([t], now, TZ);
    expect(item).toMatchObject({ preview: { time: { label: "Due", start: "2026-09-27", allDay: true }, body: "Invoice #42 for September hours" } });
  });

  it("reads a UTC-midnight due date (a bare date over MCP) as that same day", () => {
    const t = { ...task(1, null), dueDate: "2026-09-27T00:00:00.000Z" };
    const [item] = taskFeedCandidates([t], now, TZ);
    expect(item).toMatchObject({ preview: { time: { start: "2026-09-27" } } });
    expect(item?.reason).toBeUndefined();
  });

  it("ranks a task due today above one due tomorrow", () => {
    const items = taskFeedCandidates([task(1, 1), task(2, 0)], now, TZ);
    expect(items).toHaveLength(2);
    const score = (id: string) => items.find((i) => i.kind === "exhibit" && i.exhibitId === id)!.score;
    expect(score("task-2")).toBeGreaterThan(score("task-1"));
  });

  it("leaves tasks due after tomorrow, or with no due date, out of the feed", () => {
    expect(taskFeedCandidates([task(1, 3), task(2, null)], now, TZ)).toEqual([]);
  });

  it("offers no views - Tasks' only feed items are tasks", () => {
    expect(taskFeedCandidates([task(1, -1), task(2, 0)], now, TZ).every((i) => i.kind === "exhibit")).toBe(true);
  });
});
