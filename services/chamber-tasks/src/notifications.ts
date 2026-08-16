import { and, eq, isNotNull } from "drizzle-orm";
import { createPushNotification } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { env } from "./env.js";

// Pushes into Capitol's own notification center rather than this Chamber
// inventing its own alert UI - see chamber-kit's createPushNotification for
// the upsert/withdraw contract this relies on.
const pushNotification = createPushNotification({
  chamber: "tasks",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// A task surfaces once its due date is within a day out, and stays surfaced
// (re-pushed, title updated to "overdue") until it's completed or its due
// date moves - matching a personal to-do reminder, not a hard deadline
// alert.
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function dedupeKeyFor(taskId: number): string {
  return `task-due-${taskId}`;
}

// Tracks which tasks this process last pushed a "due soon" notification
// for, so a task that's completed (or its due date pushed back) between
// checks gets explicitly withdrawn instead of just silently going stale in
// Capitol's own notification list. In-memory and reset on restart - a
// notification that went stale across a restart just lingers until the
// owner dismisses it by hand, an accepted gap for a single-user system
// rather than a persisted table.
const lastNotifiedTaskIds = new Set<number>();

async function checkDueTasks(): Promise<void> {
  const now = Date.now();
  const rows = db
    .select({ id: tasks.id, name: tasks.name, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.completed, false), isNotNull(tasks.dueDate)))
    .all();

  const currentlyDue = new Set<number>();

  for (const row of rows) {
    if (!row.dueDate || row.dueDate.getTime() - now > LOOKAHEAD_MS) continue;
    currentlyDue.add(row.id);
    const overdue = row.dueDate.getTime() < now;
    await pushNotification({
      dedupeKey: dedupeKeyFor(row.id),
      title: overdue ? `"${row.name}" is overdue` : `"${row.name}" is due soon`,
      chamberUrl: `/t/${row.id}`,
    });
  }

  for (const id of lastNotifiedTaskIds) {
    if (!currentlyDue.has(id)) {
      await pushNotification({ dedupeKey: dedupeKeyFor(id), withdraw: true });
    }
  }

  lastNotifiedTaskIds.clear();
  for (const id of currentlyDue) lastNotifiedTaskIds.add(id);
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startDueTaskNotifications(): void {
  void checkDueTasks();
  interval = setInterval(() => void checkDueTasks(), CHECK_INTERVAL_MS);
}

export function stopDueTaskNotifications(): void {
  if (interval) clearInterval(interval);
}
