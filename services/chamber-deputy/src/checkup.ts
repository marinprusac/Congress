import { isAiPaused, runDirective } from "./engine.js";
import { drainPendingCheckupEvents } from "./pendingEvents.js";
import { listDueScheduledDirectives, nextScheduledWakeDelayMs, markDirectiveRunNow } from "./directives.js";

// While Congress's AI is paused (or unreachable), due directives stay due -
// nothing is stamped or drained - so the next wake is floored here rather
// than re-firing immediately in a tight loop against Congress.
export const PAUSED_RETRY_MS = 60_000;

// Single self-rescheduling timer, armed for whichever enabled+scheduled
// directive's own next run is soonest - the same "one timer for the soonest
// deadline" idiom chamber-tasks uses for due-date checks. Each due directive
// gets its own run (its own `claude` subprocess, queued in Congress) rather
// than one bundled prompt for all of them.
async function tick(): Promise<void> {
  const due = await listDueScheduledDirectives();
  if (due.length === 0) return scheduleNext();

  if (await isAiPaused()) return scheduleNext(PAUSED_RETRY_MS);

  // Drained once per tick, not once per directive - every directive due in
  // this same tick sees the same batch of events since the last one.
  const events = drainPendingCheckupEvents();
  for (const directive of due) {
    // Stamp lastRunAt now, before the run executes (it may queue behind
    // other runs in Congress) - otherwise scheduleNext() below would see
    // this directive as still due and re-fire it on the very next tick.
    await markDirectiveRunNow(directive.id);
    void runDirective({ trigger: "scheduled", events, directive }).catch((err) =>
      console.warn(`Deputy scheduled run for directive ${directive.id} failed: ${(err as Error).message}`)
    );
  }
  await scheduleNext();
}

let timer: ReturnType<typeof setTimeout> | undefined;

async function scheduleNext(minDelayMs = 0): Promise<void> {
  if (timer) clearTimeout(timer);
  const delay = await nextScheduledWakeDelayMs();
  // No enabled directive has its own timer set - leave the timer unarmed
  // rather than polling for nothing. rearmScheduler() re-checks this the
  // next time a directive is created/updated/deleted/toggled.
  if (delay === null) {
    timer = undefined;
    return;
  }
  timer = setTimeout(() => void tick(), Math.max(delay, minDelayMs));
}

// Runs once immediately on boot, then on its own self-rescheduling timer.
export function startPeriodicCheckup(): void {
  void tick();
}

export function stopPeriodicCheckup(): void {
  if (timer) clearTimeout(timer);
}

// Called from server.ts after any directive create/update/delete/toggle -
// a shortened interval or a newly-scheduled directive shouldn't have to
// wait for whatever the old timer was armed for.
export function rearmScheduler(): void {
  void scheduleNext();
}
