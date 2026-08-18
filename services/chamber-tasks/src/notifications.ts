import { and, eq, isNotNull } from "drizzle-orm";
import { createPublishEvent } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { env } from "./env.js";
import { getSettings } from "./settings.js";

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
// until it's completed or its due date moves back out of range - but the
// due_soon/overdue event itself only fires once per state transition (see
// lastNotifiedState below), not on every tick it remains true. Congress's
// event log is a switch, not a durable record (CLAUDE.md's Events section) -
// re-publishing an unchanged state every tick was flooding Logs Chamber's
// append-only event_history with one row per task per tick, and would fire
// an Automation Chamber automation repeatedly with no dedup of its own
// (unlike a log rule's notify action, which at least collapses onto one
// push via its dedupe key).
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// How often this process wakes up to see whether a due/overdue checkup is
// due yet - independent of, and much shorter than, the owner-configurable
// checkIntervalMs itself (settings.ts), same split as chamber-deputy's
// TICK_INTERVAL_MS vs. checkupIntervalMs. A code-owned tick this short means
// a lowered checkIntervalMs takes effect promptly instead of waiting for a
// restart.
const TICK_INTERVAL_MS = 60 * 1000;

// Tracks which state ("due_soon" or "overdue") this process last published
// an event for, per task - both so a task that's completed (or its due date
// pushed back) between checks gets an explicit tasks.due_cleared event
// instead of just silently going stale, and so a still-true state doesn't
// re-publish on every tick (only the due_soon -> overdue transition does,
// since that's a genuine change worth surfacing again). In-memory and reset
// on restart - same accepted gap as before this Chamber moved to events (see
// git history): on restart, every currently-due task looks "new" again and
// re-publishes once, rather than being missed entirely.
const lastNotifiedState = new Map<number, "due_soon" | "overdue">();

async function checkDueTasks(): Promise<void> {
  const now = Date.now();
  const rows = db
    .select({ id: tasks.id, name: tasks.name, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.completed, false), isNotNull(tasks.dueDate)))
    .all();

  const currentlyDue = new Map<number, "due_soon" | "overdue">();

  for (const row of rows) {
    if (!row.dueDate || row.dueDate.getTime() - now > LOOKAHEAD_MS) continue;
    const state = row.dueDate.getTime() < now ? "overdue" : "due_soon";
    currentlyDue.set(row.id, state);
    if (lastNotifiedState.get(row.id) !== state) {
      await publishEvent({
        type: state === "overdue" ? "tasks.overdue" : "tasks.due_soon",
        payload: { taskId: row.id, name: row.name, url: `/t/${row.id}` },
      });
    }
  }

  for (const id of lastNotifiedState.keys()) {
    if (!currentlyDue.has(id)) {
      await publishEvent({ type: "tasks.due_cleared", payload: { taskId: id } });
    }
  }

  lastNotifiedState.clear();
  for (const [id, state] of currentlyDue) lastNotifiedState.set(id, state);
}

// In-memory, reset on restart - same accepted gap as lastNotifiedTaskIds
// above; a restart just re-runs the checkup on the next tick rather than
// waiting out the rest of the interval.
let lastCheckAt: number | null = null;

async function tick(): Promise<void> {
  const settings = await getSettings();
  if (lastCheckAt !== null && Date.now() - lastCheckAt < settings.checkIntervalMs) return;
  lastCheckAt = Date.now();
  await checkDueTasks();
}

let tickInterval: ReturnType<typeof setInterval> | undefined;

export function startDueTaskNotifications(): void {
  void tick();
  tickInterval = setInterval(() => void tick(), TICK_INTERVAL_MS);
}

export function stopDueTaskNotifications(): void {
  if (tickInterval) clearInterval(tickInterval);
}
