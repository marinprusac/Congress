import { env } from "./env.js";
import { fetchPositionsSince } from "./traccar/client.js";
import { processPositions, withTrackingLock } from "./tracking.js";
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

// Whether this process has already published map.tracking_stale for the
// current gap - in-memory and reset on restart, same accepted tradeoff as
// chamber-tasks' lastNotifiedState (a still-stale gap just re-publishes once
// after a restart; Logs Chamber's own notify dedupes on template key, so
// that update replaces rather than duplicates the existing notification).
let staleAlertActive = false;

// Pure so it's unit-testable without a live poll loop or clock mocking -
// takes the gap between now and the last real fix directly rather than two
// Dates. Traccar polling can keep returning 200 OK indefinitely while the
// device itself has stopped sending real fixes (see map.traccar_poll_failing
// above, which only catches actual HTTP failures) - this is the dead-man's
// switch for that case.
export function nextStalenessTransition(
  gapMs: number,
  thresholdMs: number,
  wasStale: boolean
): "became_stale" | "became_fresh" | null {
  const isStale = gapMs >= thresholdMs;
  if (isStale && !wasStale) return "became_stale";
  if (!isStale && wasStale) return "became_fresh";
  return null;
}

async function checkTrackingStaleness(staleThresholdMs: number): Promise<void> {
  const { lastProcessedAt } = getPollState();
  if (!lastProcessedAt) return;
  const gapMs = Date.now() - lastProcessedAt.getTime();
  const transition = nextStalenessTransition(gapMs, staleThresholdMs, staleAlertActive);
  if (transition === "became_stale") {
    staleAlertActive = true;
    await publishEvent({
      type: "map.tracking_stale",
      payload: { lastFixAt: lastProcessedAt.toISOString(), staleMinutes: Math.round(gapMs / 60000) },
    });
  } else if (transition === "became_fresh") {
    staleAlertActive = false;
    await publishEvent({
      type: "map.tracking_resumed",
      payload: { lastFixAt: lastProcessedAt.toISOString() },
    });
  }
}

async function pollTick(): Promise<void> {
  const state = getPollState();
  const settings = await getSettings();
  // First-ever boot: look back one interval, not this Chamber's entire
  // Traccar history.
  const since = state.lastProcessedAt ?? new Date(Date.now() - settings.pollIntervalMs);
  const now = new Date();

  try {
    const positions = await fetchPositionsSince(env.TRACCAR_DEVICE_ID, since.toISOString(), now.toISOString());
    // Queued behind any in-flight reprocess (and vice versa) so the two
    // never interleave their writes - see withTrackingLock.
    await withTrackingLock(() => processPositions(positions));
    // Advance the cursor to the latest fixTime actually seen, not to
    // wall-clock `now` - Traccar can deliver a position late carrying an
    // older fixTime (e.g. a phone resending its last cached fix after a GPS
    // gap), and a wall-clock cursor would put that fixTime permanently
    // behind the query window before it ever gets fetched. A tick that
    // finds nothing leaves the cursor at `since` so the next tick re-checks
    // the same window plus whatever's new, instead of skipping ahead.
    const latest = positions.at(-1);
    const lastProcessedAt = latest ? new Date(latest.fixTime) : since;
    updatePollState({ lastProcessedAt, lastPollSucceededAt: now, lastPollError: null });
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    updatePollState({ lastPollError: message });
    console.warn(`[chamber-map] Traccar poll failed (${consecutiveFailures} in a row): ${message}`);
    if (consecutiveFailures === FAILURE_ALERT_THRESHOLD) {
      await publishEvent({
        type: "map.traccar_poll_failing",
        payload: { consecutiveFailures, lastError: message },
      });
    }
  }

  // Runs regardless of whether this tick's poll succeeded or failed - a
  // failed HTTP call and a succeeding-but-empty one both leave lastProcessedAt
  // exactly where it was, which is the only signal that matters here.
  await checkTrackingStaleness(settings.staleThresholdMs);

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
