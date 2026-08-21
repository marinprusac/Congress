import { and, eq, isNotNull } from "drizzle-orm";
import { createPublishEvent } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { env } from "./env.js";

// Publishes to Congress's push relay rather than pushing a notification
// directly - this Chamber only knows a task is due, not whether anything
// should happen about it or what that should say; the notifications
// Chamber's own rules decide that. See chamber-kit's createPublishEvent and
// this Chamber's manifest.ts for the event catalog.
export const publishEvent = createPublishEvent({
  chamber: "tasks",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// A task surfaces once its due date is within a day out, and stays surfaced
// until it's completed or its due date moves back out of range - but the
// due_soon/overdue event itself only fires once per state transition (see
// lastNotifiedState below), not every time this Chamber re-checks. A
// publish is a push-relayed switch, not a durable record (CLAUDE.md's
// Events section) - re-publishing an unchanged state on every check would
// flood Logs Chamber's append-only event_history with one row per task per
// check, and would fire an Automation Chamber automation repeatedly with no
// dedup of its own (unlike a log rule's notify action, which at least
// collapses onto one push via its dedupe key).
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// Tracks which state ("due_soon" or "overdue") this process last published
// an event for, per task - both so a task that's completed (or its due date
// pushed back) between checks gets an explicit tasks.due_cleared event
// instead of just silently going stale, and so a still-true state doesn't
// re-publish on every check (only the due_soon -> overdue transition does,
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
  // Collected and awaited together rather than one at a time in the loop -
  // due dates cluster on hour boundaries, so several thresholds crossing at
  // once used to serialize their publishes for no reason (each is already
  // its own best-effort, fire-and-forget POST on Congress's side - see
  // createPublishEvent - so none of them can reject and short-circuit this).
  const publishes: Promise<void>[] = [];

  for (const row of rows) {
    if (!row.dueDate || row.dueDate.getTime() - now > LOOKAHEAD_MS) continue;
    const state = row.dueDate.getTime() < now ? "overdue" : "due_soon";
    currentlyDue.set(row.id, state);
    if (lastNotifiedState.get(row.id) !== state) {
      publishes.push(
        publishEvent({
          type: state === "overdue" ? "tasks.overdue" : "tasks.due_soon",
          payload: { taskId: row.id, name: row.name, url: `/t/${row.id}` },
        })
      );
    }
  }

  for (const id of lastNotifiedState.keys()) {
    if (!currentlyDue.has(id)) {
      publishes.push(publishEvent({ type: "tasks.due_cleared", payload: { taskId: id } }));
    }
  }

  await Promise.all(publishes);

  lastNotifiedState.clear();
  for (const [id, state] of currentlyDue) lastNotifiedState.set(id, state);
}

// setTimeout overflows past this (2^31-1 ms, ~24.8 days) rather than firing
// - capped well under that so a due date further out than this just means
// one extra no-op wake-up before the timer's recomputed and re-armed
// closer to the real threshold.
const MAX_TIMEOUT_MS = 24 * 24 * 60 * 60 * 1000;

// The next instant a due_soon or overdue threshold is crossed, across every
// incomplete task with a due date - null when there's nothing upcoming to
// wait for. A task can cross two thresholds (due_soon, then overdue); only
// ones still in the future matter here, since anything already past is
// caught by the checkDueTasks() call that runs right before this.
function nextThresholdMs(now: number): number | null {
  const rows = db
    .select({ dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.completed, false), isNotNull(tasks.dueDate)))
    .all();

  let soonest: number | null = null;
  for (const row of rows) {
    if (!row.dueDate) continue;
    const dueMs = row.dueDate.getTime();
    for (const candidate of [dueMs - LOOKAHEAD_MS, dueMs]) {
      if (candidate > now && (soonest === null || candidate < soonest)) soonest = candidate;
    }
  }
  return soonest;
}

let wakeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleNextWake(): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  const now = Date.now();
  const nextMs = nextThresholdMs(now);
  // Nothing upcoming to wait for right now - reschedule() (called from
  // every task create/update/delete) re-arms this the moment a due date is
  // added or moved earlier, so there's nothing to poll for in the meantime.
  if (nextMs === null) {
    wakeTimer = undefined;
    return;
  }
  const delay = Math.min(nextMs - now, MAX_TIMEOUT_MS);
  wakeTimer = setTimeout(() => void runCheckAndReschedule(), delay);
}

async function runCheckAndReschedule(): Promise<void> {
  await checkDueTasks();
  scheduleNextWake();
}

// Called after every task create/update/delete (tasks.ts) - a mutation may
// have moved the soonest threshold earlier (or created/cleared one
// entirely), so this recomputes and re-arms immediately rather than waiting
// for whatever timer is already scheduled.
export function reschedule(): void {
  scheduleNextWake();
}

export function startDueTaskNotifications(): void {
  void runCheckAndReschedule();
}

export function stopDueTaskNotifications(): void {
  if (wakeTimer) clearTimeout(wakeTimer);
}
