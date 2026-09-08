import { env } from "./env.js";
import { fetchPositionsSince } from "./traccar/client.js";
import { processPositions, withTrackingLock } from "./tracking.js";
import { getPollState, updatePollState } from "./pollState.js";
import { existingPositionIds } from "./positions.js";
import { getSettings } from "./settings.js";
import { publishEvent } from "./events.js";

// Published once when a failure streak crosses this count (and reset on the
// next success), not on every failing tick - same "state transition, not
// every tick" dedup spirit as chamber-tasks' due/overdue notifications.
const FAILURE_ALERT_THRESHOLD = 3;

// Fallback interval for the reschedule when the tick failed so early that
// even the settings read didn't get through - see the finally block in
// pollTick. Deliberately not the settings default: this only ever applies
// while something is badly wrong, and retrying a broken DB read every two
// minutes is more useful than backing off.
const FALLBACK_POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let consecutiveFailures = 0;
let stopped = false;

// When this process started polling, used as the staleness reference before
// any fix has ever been processed - see checkTrackingStaleness.
let trackingStartedAt = Date.now();

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

// A cursor is only ever as new as the clock allows. A fix stamped in the
// future - a phone with a skewed clock, which real devices do produce - would
// otherwise become a cursor no later query can reach: `since` stays
// permanently ahead of `to`, so every subsequent poll asks for an inverted
// window and gets nothing back, and the staleness check below sees a
// *negative* gap so it never complains either. Silent, permanent, and only
// curable by a restart, which wouldn't help since the cursor is persisted.
export function clampToNow(candidate: Date, now: Date): Date {
  return candidate.getTime() > now.getTime() ? now : candidate;
}

async function checkTrackingStaleness(staleThresholdMs: number): Promise<void> {
  const { lastProcessedAt } = getPollState();
  // With no fix ever processed there's no gap to measure, but silence is
  // exactly what a brand-new (or freshly reset) install most needs told about
  // - a tracker that never delivers its first fix is the one failure this
  // check used to stay quiet about forever. Measure from when this process
  // started polling instead.
  const since = lastProcessedAt?.getTime() ?? trackingStartedAt;
  const gapMs = Date.now() - since;
  const transition = nextStalenessTransition(gapMs, staleThresholdMs, staleAlertActive);
  if (transition === "became_stale") {
    staleAlertActive = true;
    await publishEvent({
      type: "map.tracking_stale",
      payload: {
        lastFixAt: lastProcessedAt?.toISOString() ?? null,
        staleMinutes: Math.round(gapMs / 60000),
      },
    });
  } else if (transition === "became_fresh" && lastProcessedAt) {
    staleAlertActive = false;
    await publishEvent({
      type: "map.tracking_resumed",
      payload: { lastFixAt: lastProcessedAt.toISOString() },
    });
  }
}

// The whole body is wrapped so that the reschedule at the bottom is reached
// on *every* path out of a tick. It used to be the last statement of the
// function with several awaits ahead of it sitting outside the try - the
// settings read, the staleness check - so a single throw from any of them
// (a locked or unwritable SQLite file, a disk hiccup) rejected the tick's
// promise, skipped the setTimeout, and silently ended tracking for the
// lifetime of the process. Nothing retried and nothing said so: the poll loop
// simply stopped, which is indistinguishable from a device that stopped
// reporting until you look at whether lastPollSucceededAt is also frozen.
async function pollTick(): Promise<void> {
  let intervalMs = FALLBACK_POLL_INTERVAL_MS;
  try {
    const state = getPollState();
    const settings = await getSettings();
    intervalMs = settings.pollIntervalMs;
    const now = new Date();
    // First-ever boot: look back one interval, not this Chamber's entire
    // Traccar history.
    const since = state.lastProcessedAt ?? new Date(now.getTime() - settings.pollIntervalMs);

    try {
      const fetched = await fetchPositionsSince(env.TRACCAR_DEVICE_ID, since.toISOString(), now.toISOString());
      // Traccar's `from` is inclusive, so the fix the cursor points at comes
      // back on every tick. Classifying it again is not idempotent - see
      // existingPositionIds - so already-stored fixes are dropped before
      // tracking.ts ever sees them, while still counting as a successful poll.
      const seen = existingPositionIds(fetched.map((p) => p.id));
      const positions = fetched.filter((p) => !seen.has(p.id));
      // Queued behind any in-flight reprocess (and vice versa) so the two
      // never interleave their writes - see withTrackingLock.
      await withTrackingLock(() => processPositions(positions));
      // Advance the cursor to the latest fixTime actually seen, not to
      // wall-clock `now` - Traccar can deliver a position late carrying an
      // older fixTime (e.g. a phone resending its last cached fix after a GPS
      // gap), and a wall-clock cursor would put that fixTime permanently
      // behind the query window before it ever gets fetched. A tick that
      // finds nothing new leaves the cursor at `since` so the next tick
      // re-checks the same window plus whatever's new, instead of skipping
      // ahead. Taken from the full fetched batch rather than the filtered one
      // so a tick that saw only already-known fixes still can't rewind.
      const latest = fetched.at(-1);
      const lastProcessedAt = clampToNow(latest ? new Date(latest.fixTime) : since, now);
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
    // failed HTTP call and a succeeding-but-empty one both leave
    // lastProcessedAt exactly where it was, which is the only signal that
    // matters here.
    await checkTrackingStaleness(settings.staleThresholdMs);
  } catch (error) {
    // Only reachable from the non-Traccar work above (settings/poll-state
    // reads, the staleness publish). Logged rather than swallowed silently,
    // but never allowed to stop the loop.
    console.error("[chamber-map] poll tick failed outside the Traccar call:", error);
  } finally {
    // Reads pollIntervalMs fresh each tick (rather than fixing it once at
    // startup in a setInterval) so a change made in Settings takes effect on
    // the very next tick, not just after a restart.
    if (!stopped) pollTimer = setTimeout(() => void pollTick(), intervalMs);
  }
}

export function startTracking(): void {
  stopped = false;
  trackingStartedAt = Date.now();
  staleAlertActive = false;
  void pollTick();
}

export function stopTracking(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
}
