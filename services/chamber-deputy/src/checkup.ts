import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import { drainPendingCheckupEvents } from "./pendingEvents.js";
import { listDueScheduledDirectives, nextScheduledWakeDelayMs, markDirectiveRunNow } from "./directives.js";
import { withRunningDirective } from "./runningState.js";

// Single self-rescheduling timer, armed for whichever enabled+scheduled
// directive's own (lastRunAt + intervalMs) is soonest - the same "one timer
// for the soonest deadline" idiom chamber-tasks uses for due-date checks,
// just per-directive here instead of per-task. Each due directive gets its
// own runDeputy call (its own `claude` subprocess) rather than one bundled
// prompt for all of them.
async function tick(): Promise<void> {
  const settings = await getSettings();
  if (!settings.paused) {
    const due = await listDueScheduledDirectives();
    if (due.length > 0) {
      // Drained once per tick, not once per directive - every directive due
      // in this same tick sees the same batch of events since the last one.
      const events = drainPendingCheckupEvents();
      for (const directive of due) {
        // Stamp lastRunAt now, before the run actually executes (it's
        // queued behind the concurrency-1 job queue and may take a while) -
        // otherwise scheduleNext() below would see this directive as still
        // due and re-fire it on the very next tick.
        await markDirectiveRunNow(directive.id);
        void enqueue(() => withRunningDirective(directive.id, () => runDeputy({ trigger: "scheduled", events, directive }))).catch((err) =>
          console.warn(`Deputy scheduled run for directive ${directive.id} failed: ${(err as Error).message}`)
        );
      }
    }
  }
  await scheduleNext();
}

let timer: ReturnType<typeof setTimeout> | undefined;

async function scheduleNext(): Promise<void> {
  if (timer) clearTimeout(timer);
  const delay = await nextScheduledWakeDelayMs();
  // No enabled directive has its own timer set - leave the timer unarmed
  // rather than polling for nothing. rearmScheduler() re-checks this the
  // next time a directive is created/updated/deleted/toggled.
  if (delay === null) {
    timer = undefined;
    return;
  }
  timer = setTimeout(() => void tick(), delay);
}

// Runs once immediately on boot (same as the old poller's first tick firing
// right away), then on its own self-rescheduling timer after that.
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
