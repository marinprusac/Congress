import type { ConnectorContext, SyncResult } from "../contract.js";
import { fetchRoutineFolders, fetchRoutinesPage, fetchWorkout, fetchWorkoutEventsPage } from "./client.js";
import { interpretHevyEvent, normalizeHevyWorkout, normalizeRoutine, normalizeRoutineFolder } from "./normalize.js";
import { getHevySettings, getRoutineRow, listRoutineRows, removeRoutine, removeWorkout, storeFolders, updateHevySettings, upsertRoutine, upsertWorkout } from "./cache.js";
import type { RoutineDetail, RoutineFolder } from "./types.js";

// Published once when a failure streak reaches this, not on every failing poll.
const FAILURE_ALERT_THRESHOLD = 3;
const EPOCH = new Date(0).toISOString();

// Workouts changed since the cursor; the first sync (from the epoch) is quiet.
async function syncWorkouts(ctx: ConnectorContext, apiKey: string): Promise<number> {
  const { cursor, publishEvents } = getHevySettings();
  const quiet = !cursor;
  let latest: string | null = null;
  let changed = 0;
  let page = 1;
  let pageCount = 1;
  do {
    const res = await fetchWorkoutEventsPage(apiKey, cursor ?? EPOCH, page);
    pageCount = res.pageCount;
    for (const raw of res.events) {
      const event = interpretHevyEvent(raw as Record<string, unknown>);
      if (!event.hevyId) continue;
      if (!latest || event.timestamp > latest) latest = event.timestamp;
      if (event.kind === "deleted") {
        if (removeWorkout(event.hevyId)) ctx.emitChange("workout", event.hevyId, true);
        changed++;
        continue;
      }
      const w = normalizeHevyWorkout((event.workout ?? (await fetchWorkout(apiKey, event.hevyId))) as Record<string, unknown>);
      const created = upsertWorkout(w);
      ctx.emitChange("workout", w.hevyId, false, quiet);
      changed++;
      if (created && !quiet && publishEvents) {
        const recordId = ctx.records.idFor("workout", w.hevyId);
        ctx.publish("fitness.workout_synced", { workoutId: recordId ?? w.hevyId, title: w.title, url: recordId ? `/e/${recordId}` : null });
      }
    }
    page++;
  } while (page <= pageCount);
  if (latest) updateHevySettings({ cursor: latest });
  else if (!cursor) updateHevySettings({ cursor: new Date().toISOString() });
  return changed;
}

async function allPages<T>(fetchPage: (page: number) => Promise<{ items: unknown[]; pageCount: number }>, map: (raw: Record<string, unknown>) => T): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const res = await fetchPage(page);
    pageCount = res.pageCount;
    out.push(...res.items.map((r) => map(r as Record<string, unknown>)));
    page++;
  } while (page <= pageCount);
  return out;
}

export async function fetchAllRoutines(apiKey: string): Promise<RoutineDetail[]> {
  return allPages(async (p) => {
    const r = await fetchRoutinesPage(apiKey, p);
    return { items: r.routines, pageCount: r.pageCount };
  }, normalizeRoutine);
}

export async function fetchAllFolders(apiKey: string): Promise<RoutineFolder[]> {
  return allPages(async (p) => {
    const r = await fetchRoutineFolders(apiKey, p);
    return { items: r.folders, pageCount: r.pageCount };
  }, normalizeRoutineFolder);
}

// Routines are few: the whole list each time. One gone from Hevy is deleted.
async function syncRoutines(ctx: ConnectorContext, apiKey: string): Promise<number> {
  storeFolders(await fetchAllFolders(apiKey));
  const known = listRoutineRows();
  const quiet = known.length === 0;
  const seen = new Set<string>();
  let changed = 0;
  for (const r of await fetchAllRoutines(apiKey)) {
    seen.add(r.id);
    const before = getRoutineRow(r.id);
    if (before && before.hevyUpdatedAt === r.updatedAt && before.title === r.title) continue;
    upsertRoutine(r);
    ctx.emitChange("routine", r.id, false, quiet);
    changed++;
  }
  for (const row of known) {
    if (seen.has(row.hevyId)) continue;
    removeRoutine(row.hevyId);
    ctx.emitChange("routine", row.hevyId, true);
    changed++;
  }
  return changed;
}

let running: Promise<SyncResult> | null = null;

export function syncHevy(ctx: ConnectorContext): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    const settings = getHevySettings();
    if (!settings.apiKey) return { changed: 0, error: null };
    try {
      const changed = (await syncWorkouts(ctx, settings.apiKey)) + (await syncRoutines(ctx, settings.apiKey));
      updateHevySettings({ consecutiveFailures: 0, lastError: null });
      return { changed, error: null };
    } catch (err) {
      const message = (err as Error).message;
      const failures = settings.consecutiveFailures + 1;
      updateHevySettings({ consecutiveFailures: failures, lastError: message });
      if (failures === FAILURE_ALERT_THRESHOLD && settings.publishEvents) ctx.publish("fitness.sync_failing", { consecutiveFailures: failures, lastError: message });
      return { changed: 0, error: message };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
