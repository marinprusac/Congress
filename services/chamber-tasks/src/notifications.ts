import { and, eq, isNotNull } from "drizzle-orm";
import { createPublishEvent } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { env } from "./env.js";

// Publishes to Congress's generic event log rather than pushing a
// notification directly - this Chamber only knows a task is due, not
// whether anything should happen about it or what that should say; the
// notifications Chamber's own automations decide that. See
// chamber-kit's createPublishEvent and this Chamber's manifest.ts for the
// event catalog.
const publishEvent = createPublishEvent({
  chamber: "tasks",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// A task surfaces once its due date is within a day out, and stays surfaced
// (re-published, "overdue" once past due) until it's completed or its due
// date moves - matching a personal to-do reminder, not a hard deadline
// alert.
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

// Tracks which tasks this process last published a due/overdue event for,
// so a task that's completed (or its due date pushed back) between checks
// gets an explicit tasks.due_cleared event instead of just silently going
// stale. In-memory and reset on restart - same accepted gap as before this
// Chamber moved to events (see git history), just re-detected as "newly
// due" on the next check after a restart rather than missed entirely.
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
    await publishEvent({
      type: overdue ? "tasks.overdue" : "tasks.due_soon",
      payload: { taskId: row.id, name: row.name, url: `/t/${row.id}` },
    });
  }

  for (const id of lastNotifiedTaskIds) {
    if (!currentlyDue.has(id)) {
      await publishEvent({ type: "tasks.due_cleared", payload: { taskId: id } });
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
