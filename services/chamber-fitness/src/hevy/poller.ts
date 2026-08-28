import { env } from "../env.js";
import { getSettings } from "../settings.js";
import { getSyncState, updateSyncState } from "./pollState.js";
import { fetchWorkoutEventsPage, fetchWorkout } from "./client.js";
import { interpretHevyEvent, normalizeHevyWorkout } from "./normalize.js";
import { upsertWorkoutFromHevy, deleteWorkoutByHevyId } from "../workouts.js";
import { publishEvent } from "../events.js";

// Published once when a failure streak crosses this count (and reset on the
// next success), not on every failing tick - same "state transition, not
// every tick" dedup spirit as chamber-tasks' due/overdue notifications and
// chamber-map's own Traccar-poll alert.
const FAILURE_ALERT_THRESHOLD = 3;
const EPOCH = new Date(0).toISOString();

// Applies one already-fetched page of raw /v1/workouts/events entries:
// upserts/deletes the local mirror and publishes fitness.workout_synced for
// each newly-created workout. Kept separate from doPoll below so it's
// directly testable against a fake events array, without a real Hevy API
// call in the loop.
export async function processHevyEvents(rawEvents: unknown[], apiKey: string): Promise<{ latestTimestamp: string | null }> {
  let latestSeen: string | null = null;

  for (const raw of rawEvents) {
    const event = interpretHevyEvent(raw as Record<string, unknown>);
    if (!event.hevyId) continue;
    if (!latestSeen || event.timestamp > latestSeen) latestSeen = event.timestamp;

    if (event.kind === "deleted") {
      await deleteWorkoutByHevyId(event.hevyId);
      continue;
    }

    const rawWorkout = event.workout ?? (await fetchWorkout(apiKey, event.hevyId));
    const normalized = normalizeHevyWorkout(rawWorkout as Record<string, unknown>);
    const result = await upsertWorkoutFromHevy(
      normalized.hevyId,
      normalized.title,
      new Date(normalized.startTime),
      new Date(normalized.endTime),
      normalized.exercises
    );
    if (result.created) {
      await publishEvent({
        type: "fitness.workout_synced",
        payload: { workoutId: result.id, title: normalized.title, priority: "normal" },
      });
    }
  }

  return { latestTimestamp: latestSeen };
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let inFlight = false;

// Exported for src/hevy/poller.test.ts, which drives it directly (with
// client.ts's Hevy calls mocked) to exercise the failure-threshold path
// without a real timer loop.
export async function doPoll(): Promise<void> {
  const settings = await getSettings();
  if (!settings.hevyApiKey) return;
  const apiKey = settings.hevyApiKey;

  const state = getSyncState();
  // First-ever sync: look back to the epoch rather than requiring a manual
  // seed - Hevy's own events endpoint paginates, so this doesn't risk an
  // unbounded single request.
  const since = state.lastSyncedAt?.toISOString() ?? EPOCH;

  try {
    let page = 1;
    let pageCount = 1;
    let latestSeen: string | null = null;
    do {
      const { events, pageCount: total } = await fetchWorkoutEventsPage(apiKey, since, page);
      pageCount = total;
      const { latestTimestamp } = await processHevyEvents(events, apiKey);
      if (latestTimestamp && (!latestSeen || latestTimestamp > latestSeen)) latestSeen = latestTimestamp;
      page += 1;
    } while (page <= pageCount);

    // Advance the cursor to the latest event timestamp actually seen, not
    // wall-clock now - tolerates a late/out-of-order event the same way
    // chamber-map's poller does for Traccar fixes. A tick with nothing new
    // leaves the cursor where it was.
    updateSyncState({
      lastSyncedAt: latestSeen ? new Date(latestSeen) : (state.lastSyncedAt ?? new Date()),
      lastError: null,
      consecutiveFailures: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const consecutiveFailures = state.consecutiveFailures + 1;
    updateSyncState({ consecutiveFailures, lastError: message });
    console.warn(`[chamber-fitness] Hevy poll failed (${consecutiveFailures} in a row): ${message}`);
    if (consecutiveFailures === FAILURE_ALERT_THRESHOLD) {
      await publishEvent({
        type: "fitness.sync_failing",
        payload: { consecutiveFailures, lastError: message, priority: "high" },
      });
    }
  }
}

// Guards doPoll against overlapping itself - the scheduled tick and a
// manual "Sync now"/settings-change trigger (see syncNow below) can
// otherwise race and interleave writes, same concern chamber-map's
// withTrackingLock addresses for its own poller.
async function runPollCycle(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await doPoll();
  } finally {
    inFlight = false;
  }
}

async function pollTick(): Promise<void> {
  await runPollCycle();
  if (!stopped) pollTimer = setTimeout(() => void pollTick(), env.HEVY_POLL_INTERVAL_MS);
}

export function startHevySync(): void {
  stopped = false;
  void pollTick();
}

export function stopHevySync(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
}

// Runs one sync cycle immediately, without disturbing the scheduled timer -
// backs the Settings page's "Sync now" button and settings.ts's
// updateSettings wrapper (fired right after a hevyApiKey change).
export function syncNow(): Promise<void> {
  return runPollCycle();
}
