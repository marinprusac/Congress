import type { TaskSummary } from "../../../src/types";

// Compares by calendar day, not exact instant - a due date of "today" is
// only overdue once the calendar day actually rolls over, not from the
// stored local-midnight instant onward (see dateInput.ts).
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type DueCategory = "overdue" | "today" | "soon" | null;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function categorizeDueDate(task: Pick<TaskSummary, "dueDate" | "completed">, now: Date = new Date()): DueCategory {
  if (task.completed || !task.dueDate) return null;
  const dueDay = startOfDay(new Date(task.dueDate));
  const todayDay = startOfDay(now);
  const diffDays = Math.round((dueDay - todayDay) / MS_PER_DAY);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "soon";
  return null;
}

// Open tasks before completed ones, then by due date ascending with
// no-due-date tasks last, then by creation date ascending.
export function compareTasks(a: TaskSummary, b: TaskSummary): number {
  const completedDiff = Number(a.completed) - Number(b.completed);
  if (completedDiff !== 0) return completedDiff;

  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    const dueDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (dueDiff !== 0) return dueDiff;
  }

  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function sortTasks(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort(compareTasks);
}

export type TaskBlock =
  | { kind: "group"; category: "overdue" | "today" | "soon"; tasks: TaskSummary[] }
  | { kind: "single"; task: TaskSummary };

// Sorted output already runs overdue tasks, then due-today tasks, then
// tasks due within the next week, then the rest, as contiguous stretches -
// this just re-packages those runs so they can be wrapped in one bordered
// box each.
export function groupByDueCategory(tasks: TaskSummary[], now: Date = new Date()): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  for (const task of tasks) {
    const category = categorizeDueDate(task, now);
    const last = blocks[blocks.length - 1];
    if (category && last?.kind === "group" && last.category === category) {
      last.tasks.push(task);
    } else if (category) {
      blocks.push({ kind: "group", category, tasks: [task] });
    } else {
      blocks.push({ kind: "single", task });
    }
  }
  return blocks;
}
