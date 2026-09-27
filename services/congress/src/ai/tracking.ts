import { randomUUID } from "node:crypto";
import type { TrackedItem } from "@congress/shared-types";
import { onEventPublished, type PublishedEvent } from "../events.js";
import { enqueue, JobCancelledError, PRIORITY } from "./jobQueue.js";
import { runAi } from "./engine.js";
import { getAiSettings } from "./settings.js";
import { threadForRun } from "./asks.js";
import { describeRecurrence, nextOccurrenceAfter } from "./recurrence.js";
import { checkingItems, dueTracking, getTracking, nextTrackingCheckMs, onTrackingChange, serverTimeZone, setTrackingSchedule } from "./memory.js";

// Background checks for tracked items: on their schedule, when a watched
// event happens, or on the owner's "Check now". A check reaches the owner
// only through asks (send_message etc.); its own reply stays in ai_runs.

const MAX_TIMEOUT_MS = 24 * 24 * 60 * 60 * 1000;
// A refused check (paused / over budget) comes back later instead.
export const REFUSED_RETRY_MS = 30 * 60 * 1000;
const EVENT_COOLDOWN_MS = 60_000;
// The AI's own actions must not trigger its own checks.
const SELF_ACTORS = new Set(["congress"]);

export type CheckTrigger = "schedule" | "event" | "owner";

const lastEventCheck = new Map<number, number>();

function localTime(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function trackingCheckBody(item: TrackedItem, trigger: CheckTrigger, zone: string, event?: PublishedEvent): string {
  const lines = [`## ${trigger === "event" ? "Event" : trigger === "owner" ? "Owner-requested" : "Scheduled"} check: "${item.title}" (tracked item #${item.id})`];
  if (item.body.trim()) lines.push(item.body.trim());
  lines.push("");
  lines.push(`Last checked: ${item.lastCheckedAt ? localTime(new Date(item.lastCheckedAt), zone) : "never"}.`);
  lines.push(item.recurrence ? `Repeats ${describeRecurrence(item.recurrence)} - the next check is already scheduled.` : "No recurrence: set nextCheckAt with update_tracking if this should keep going.");
  if (item.refs.length) lines.push(`Related: ${item.refs.join(" ")}`);
  if (event) {
    lines.push("");
    lines.push(`### The event that triggered this check\n${event.chamber} · ${event.type} at ${event.occurredAt}\n\`\`\`json\n${JSON.stringify(event.payload ?? null).slice(0, 4000)}\n\`\`\``);
  }
  lines.push("");
  lines.push(
    "Do what this item calls for: look at the relevant data with your tools. Reach the owner only if something deserves their attention (send_message / ask_question / propose_actions), otherwise change nothing visible. Keep the item current with update_tracking: progress notes in the body, a new nextCheckAt, or status done/dropped once it no longer applies. End with a one-line summary of what you did (the owner doesn't see it)."
  );
  return lines.join("\n");
}

// Returns the run id, or null when this item can't be checked right now.
export async function startTrackingCheck(itemId: number, trigger: CheckTrigger, event?: PublishedEvent, now = new Date()): Promise<string | null> {
  const item = getTracking(itemId);
  if (!item || checkingItems.has(itemId)) return null;
  if (item.status !== "active" && trigger !== "owner") return null;
  const settings = await getAiSettings();
  const zone = serverTimeZone(settings.timeZone);

  // Stamped before the run, so a crash can't make it fire twice.
  const next = item.recurrence ? new Date(nextOccurrenceAfter(item.recurrence, now.getTime(), zone)) : trigger === "schedule" ? null : undefined;
  setTrackingSchedule(itemId, { lastCheckedAt: now, ...(next !== undefined ? { nextCheckAt: next } : {}) });

  const runId = randomUUID();
  checkingItems.add(itemId);
  const body = trackingCheckBody(item, trigger, zone, event);
  void enqueue(
    (signal) =>
      runAi({ kind: "tracking", body, actor: "congress", runId, threadId: item.threadId, trigger: trigger === "owner" ? "owner-check" : trigger, signal, meta: { trackingId: itemId } }),
    { entry: { runId, kind: "tracking", threadId: item.threadId, meta: { trackingId: itemId } }, priority: PRIORITY.tracking }
  )
    .then((result) => {
      // Try again later rather than silently skipping a scheduled check.
      if (result.refused && trigger === "schedule") setTrackingSchedule(itemId, { nextCheckAt: new Date(Date.now() + REFUSED_RETRY_MS) });
      const opened = threadForRun(runId);
      if (!item.threadId && opened) setTrackingSchedule(itemId, { threadId: opened });
    })
    .catch((err: unknown) => {
      if (!(err instanceof JobCancelledError)) console.warn(`Tracking check #${itemId} failed:`, err);
    })
    .finally(() => {
      checkingItems.delete(itemId);
      rearmTrackingTimer();
    });
  return runId;
}

export async function runTrackingTick(now = new Date()): Promise<void> {
  for (const item of dueTracking(now)) await startTrackingCheck(item.id, "schedule", undefined, now);
}

export function eventMatches(item: TrackedItem, type: string): boolean {
  return item.watchEvents.some((w) => w.immediate && (w.type === type || w.type === "*" || (w.type.endsWith(".*") && type.startsWith(w.type.slice(0, -1)))));
}

export function handleEventForTracking(event: PublishedEvent, items: TrackedItem[], now = Date.now()): number[] {
  if (event.actor && SELF_ACTORS.has(event.actor)) return [];
  const fired: number[] = [];
  for (const item of items) {
    if (item.status !== "active" || !eventMatches(item, event.type)) continue;
    if (now - (lastEventCheck.get(item.id) ?? 0) < EVENT_COOLDOWN_MS) continue;
    lastEventCheck.set(item.id, now);
    fired.push(item.id);
  }
  return fired;
}

// ---- Timer ----

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let unsubscribe: (() => void) | undefined;

export function rearmTrackingTimer(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!running) return;
  const next = nextTrackingCheckMs();
  if (next === null) return;
  timer = setTimeout(
    () => {
      void runTrackingTick()
        .catch((err) => console.warn("Tracking tick failed:", err))
        .finally(rearmTrackingTimer);
    },
    Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS)
  );
}

export function startTrackingScheduler(listItems: () => TrackedItem[]): void {
  running = true;
  onTrackingChange(rearmTrackingTimer);
  unsubscribe = onEventPublished((event) => {
    for (const id of handleEventForTracking(event, listItems())) void startTrackingCheck(id, "event", event);
  });
  void runTrackingTick().finally(rearmTrackingTimer);
}

export function stopTrackingScheduler(): void {
  running = false;
  unsubscribe?.();
  if (timer) clearTimeout(timer);
}
