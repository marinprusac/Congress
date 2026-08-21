import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import { drainPendingCheckupEvents } from "./pendingEvents.js";
import { hasEnabledTimeBasedDirective } from "./directives.js";

// Self-rescheduling timer rather than a fixed setInterval - settings.
// checkupIntervalMs is owner-tunable (settings.ts), and reading it fresh
// each time this arms the next wait means a changed interval takes effect
// on the very next firing instead of needing a restart.
async function runPeriodicCheckup(): Promise<void> {
  const settings = await getSettings();
  if (!settings.paused) {
    const events = drainPendingCheckupEvents();
    // A tick with nothing pending and no directive that needs a wall-clock
    // wake has nothing to check up on - spawning a headless `claude`
    // subprocess (and, on a shared VPS, its CPU/memory) for it is pure
    // waste. Still costs one cheap indexed SELECT every tick either way.
    if (events.length > 0 || (await hasEnabledTimeBasedDirective())) {
      void enqueue(() => runDeputy({ trigger: "periodic", events })).catch((err) =>
        console.warn(`Deputy periodic checkup failed: ${(err as Error).message}`)
      );
    }
  }
  scheduleNext();
}

let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleNext(): void {
  void getSettings().then((settings) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runPeriodicCheckup(), settings.checkupIntervalMs);
  });
}

// Runs once immediately on boot (same as the old poller's first tick firing
// right away), then on its own self-rescheduling interval after that.
export function startPeriodicCheckup(): void {
  void runPeriodicCheckup();
}

export function stopPeriodicCheckup(): void {
  if (timer) clearTimeout(timer);
}
