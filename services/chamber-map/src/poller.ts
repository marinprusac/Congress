import { env } from "./env.js";
import { fetchPositionsSince } from "./traccar/client.js";
import { processPositions } from "./tracking.js";
import { getPollState, updatePollState } from "./pollState.js";
import { publishEvent } from "./events.js";

// Published once when a failure streak crosses this count (and reset on the
// next success), not on every failing tick - same "state transition, not
// every tick" dedup spirit as chamber-tasks' due/overdue notifications.
const FAILURE_ALERT_THRESHOLD = 3;

let pollTimer: ReturnType<typeof setInterval> | undefined;
let consecutiveFailures = 0;

async function pollTick(): Promise<void> {
  const state = getPollState();
  // First-ever boot: look back one interval, not this Chamber's entire
  // Traccar history.
  const since = state.lastProcessedAt?.toISOString() ?? new Date(Date.now() - env.POLL_INTERVAL_MS).toISOString();
  const now = new Date();

  try {
    const positions = await fetchPositionsSince(env.TRACCAR_DEVICE_ID, since, now.toISOString());
    await processPositions(positions);
    updatePollState({ lastProcessedAt: now, lastPollSucceededAt: now, lastPollError: null });
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    updatePollState({ lastPollError: message });
    console.warn(`[chamber-map] Traccar poll failed (${consecutiveFailures} in a row): ${message}`);
    if (consecutiveFailures === FAILURE_ALERT_THRESHOLD) {
      await publishEvent({
        type: "map.traccar_poll_failing",
        payload: { consecutiveFailures, lastError: message, priority: "high" },
      });
    }
  }
}

export function startTracking(): void {
  void pollTick();
  pollTimer = setInterval(() => void pollTick(), env.POLL_INTERVAL_MS);
}

export function stopTracking(): void {
  if (pollTimer) clearInterval(pollTimer);
}
