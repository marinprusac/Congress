import { describe, expect, it } from "vitest";
import { categorizeDueDate, groupByDueCategory, sortTasks } from "./taskSort.js";
import type { TaskSummary } from "../../../src/types";

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 0,
    name: "task",
    description: "",
    dueDate: null,
    completed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-09-09T12:00:00.000Z");

describe("categorizeDueDate", () => {
  it("is not overdue for a task due later today, even though the stored due instant has already passed", () => {
    // dueDate is local midnight of the due day (see dateInput.ts) - by
    // noon "today" that instant is in the past, but the calendar day
    // hasn't rolled over yet.
    const t = task({ dueDate: "2026-09-09T00:00:00.000Z" });
    expect(categorizeDueDate(t, NOW)).toBe("today");
  });

  it("is overdue once the due day is strictly before today", () => {
    const t = task({ dueDate: "2026-09-08T00:00:00.000Z" });
    expect(categorizeDueDate(t, NOW)).toBe("overdue");
  });

  it("is due-soon for a date within the next 7 days", () => {
    const tomorrow = task({ dueDate: "2026-09-10T00:00:00.000Z" });
    const inAWeek = task({ dueDate: "2026-09-16T00:00:00.000Z" });
    expect(categorizeDueDate(tomorrow, NOW)).toBe("soon");
    expect(categorizeDueDate(inAWeek, NOW)).toBe("soon");
  });

  it("is neither overdue, due-today, nor due-soon for a date more than 7 days out", () => {
    const t = task({ dueDate: "2026-09-17T00:00:00.000Z" });
    expect(categorizeDueDate(t, NOW)).toBeNull();
  });

  it("is never flagged for a completed task, even if its due date is in the past", () => {
    const t = task({ dueDate: "2026-09-01T00:00:00.000Z", completed: true });
    expect(categorizeDueDate(t, NOW)).toBeNull();
  });

  it("is null for a task with no due date", () => {
    expect(categorizeDueDate(task({ dueDate: null }), NOW)).toBeNull();
  });
});

describe("sortTasks", () => {
  it("orders open tasks by due date ascending, with no-due-date tasks last", () => {
    const noDue = task({ id: 1, dueDate: null, createdAt: "2026-01-01T00:00:00.000Z" });
    const later = task({ id: 2, dueDate: "2026-09-15T00:00:00.000Z" });
    const sooner = task({ id: 3, dueDate: "2026-09-10T00:00:00.000Z" });
    const sorted = sortTasks([noDue, later, sooner]);
    expect(sorted.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("breaks ties on the same due date by creation date, older first", () => {
    const newer = task({ id: 1, dueDate: "2026-09-10T00:00:00.000Z", createdAt: "2026-02-01T00:00:00.000Z" });
    const older = task({ id: 2, dueDate: "2026-09-10T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(sortTasks([newer, older]).map((t) => t.id)).toEqual([2, 1]);
  });

  it("keeps completed tasks after open ones regardless of due date", () => {
    const doneEarly = task({ id: 1, completed: true, dueDate: "2026-09-01T00:00:00.000Z" });
    const openLate = task({ id: 2, completed: false, dueDate: "2026-12-01T00:00:00.000Z" });
    expect(sortTasks([doneEarly, openLate]).map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("groupByDueCategory", () => {
  it("packs consecutive tasks of the same due-date category into one group each", () => {
    const overdue1 = task({ id: 1, dueDate: "2026-09-07T00:00:00.000Z" });
    const overdue2 = task({ id: 2, dueDate: "2026-09-08T00:00:00.000Z" });
    const dueToday = task({ id: 3, dueDate: "2026-09-09T00:00:00.000Z" });
    const soon1 = task({ id: 4, dueDate: "2026-09-10T00:00:00.000Z" });
    const soon2 = task({ id: 5, dueDate: "2026-09-14T00:00:00.000Z" });
    const future = task({ id: 6, dueDate: "2026-09-20T00:00:00.000Z" });
    const noDue = task({ id: 7, dueDate: null });

    const blocks = groupByDueCategory(sortTasks([overdue1, overdue2, dueToday, soon1, soon2, future, noDue]), NOW);

    expect(blocks).toEqual([
      { kind: "group", category: "overdue", tasks: [overdue1, overdue2] },
      { kind: "group", category: "today", tasks: [dueToday] },
      { kind: "group", category: "soon", tasks: [soon1, soon2] },
      { kind: "single", task: future },
      { kind: "single", task: noDue },
    ]);
  });
});
