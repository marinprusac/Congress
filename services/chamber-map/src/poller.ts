import { env } from "./env.js";
import { fetchPositionsSince } from "./traccar/client.js";
import { processPositions } from "./tracking.js";
import { getPollState, updatePollState } from "./pollState.js";
import { getSettings } from "./settings.js";
import { publishEvent } from "./events.js";

// Published once when a failure streak crosses this count (and reset on the
// next success), not on every failing tick - same "state transition, not
// every tick" dedup spirit as chamber-tasks' due/overdue notifications.
const FAILURE_ALERT_THRESHOLD = 3;

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let consecutiveFailures = 0;
let stopped = false;

async function pollTick(): Promise<void> {
  const state = getPollState();
  const settings = await getSettings();
  // First-ever boot: look back one interval, not this Chamber's entire
  // Traccar history.
  const since = state.lastProcessedAt?.toISOString() ?? new Date(Date.now() - settings.pollIntervalMs).toISOString();
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

  // Reads pollIntervalMs fresh each tick (rather than fixing it once at
  // startup in a setInterval) so a change made in Settings takes effect on
  // the very next tick, not just after a restart.
  if (!stopped) pollTimer = setTimeout(() => void pollTick(), settings.pollIntervalMs);
}

export function startTracking(): void {
  stopped = false;
  void pollTick();
}

export function stopTracking(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
}
