import { desc, eq, gte } from "drizzle-orm";
import type { WorkoutSummary, WorkoutDetail, WorkoutExercise } from "./types.js";
import { db } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { toExhibitId, parseWorkoutId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, deleteManualRefsForWorkout } from "./refs.js";
import { composeExhibitTitle, dayKeyUTC, workoutsInDayTitleBucket } from "./workoutTitle.js";

function toSummary(row: typeof workouts.$inferSelect): WorkoutSummary {
  return {
    id: row.id,
    hevyId: row.hevyId,
    title: row.title,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    exerciseCount: row.exerciseCount,
    totalVolumeKg: row.totalVolumeKg,
  };
}

function toDetail(row: typeof workouts.$inferSelect): WorkoutDetail {
  return { ...toSummary(row), exercises: JSON.parse(row.exercisesJson) as WorkoutExercise[] };
}

export async function listWorkouts(limit = 50): Promise<WorkoutSummary[]> {
  const rows = db.select().from(workouts).orderBy(desc(workouts.startTime)).limit(limit).all();
  return rows.map(toSummary);
}

// Most recent workouts, capped - powers the homepage widget.
export async function listRecentWorkouts(limit = 5): Promise<WorkoutSummary[]> {
  return listWorkouts(limit);
}

export async function getWorkout(id: number): Promise<WorkoutDetail | null> {
  const row = db.select().from(workouts).where(eq(workouts.id, id)).get();
  return row ? toDetail(row) : null;
}

export interface WeekStats {
  workoutCount: number;
  totalVolumeKg: number;
}

// Monday 00:00 local time through now - a fixed calendar week, matching how
// "this week" reads on a calendar, not a rolling 7 days.
function startOfIsoWeek(now: Date): Date {
  const day = now.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift Sunday(0) back to the prior Monday
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function getWeekStats(): Promise<WeekStats> {
  const start = startOfIsoWeek(new Date());
  const rows = db.select().from(workouts).where(gte(workouts.startTime, start)).all();
  return {
    workoutCount: rows.length,
    totalVolumeKg: rows.reduce((sum, row) => sum + (row.totalVolumeKg ?? 0), 0),
  };
}

function computeExerciseStats(exercises: WorkoutExercise[]): {
  exerciseCount: number;
  totalVolumeKg: number | null;
  exerciseNames: string;
} {
  const exerciseCount = exercises.length;
  const exerciseNames = exercises.map((exercise) => exercise.name).join(" ");
  let totalVolumeKg: number | null = null;
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      if (set.weightKg != null && set.reps != null) {
        totalVolumeKg = (totalVolumeKg ?? 0) + set.weightKg * set.reps;
      }
    }
  }
  return { exerciseCount, totalVolumeKg, exerciseNames };
}

async function syncWorkoutExhibit(id: number, title: string, startTime: Date): Promise<void> {
  // Workouts have no body text of their own to parse "[[" tokens out of -
  // unlike items.ts's syncItemExhibit, outgoingRefs is exactly the manual
  // References-panel set, not a union with anything parsed.
  const manual = listManualRefs(id);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "workout",
    name: composeExhibitTitle(id, title, startTime),
    url: `/fitness/workouts/${id}`,
    outgoingRefs: manual,
    manualRefs: manual,
  });
}

// Re-syncs every exhibit in a title+day bucket - needed whenever a workout
// enters or leaves one, since every sibling's (2)/(3)/... rank can shift.
async function resyncDayTitleBucket(title: string, startTime: Date): Promise<void> {
  for (const row of workoutsInDayTitleBucket(title, startTime)) {
    await syncWorkoutExhibit(row.id, title, row.startTime);
  }
}

// Re-syncs a workout whose manual refs changed (see the
// /api/exhibits/:id/refs routes in server.ts).
export async function resyncWorkoutExhibit(id: number): Promise<void> {
  const row = db.select().from(workouts).where(eq(workouts.id, id)).get();
  if (!row) return;
  await syncWorkoutExhibit(id, row.title, row.startTime);
}

export async function resyncWorkoutExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseWorkoutId(exhibitId);
  if (id !== null) await resyncWorkoutExhibit(id);
}

export interface UpsertResult {
  id: number;
  created: boolean;
}

// Called by hevy/poller.ts for every "updated" event. Upserts by hevyId
// since Hevy, not this Chamber, owns workout identity.
export async function upsertWorkoutFromHevy(
  hevyId: string,
  title: string,
  startTime: Date,
  endTime: Date,
  exercises: WorkoutExercise[]
): Promise<UpsertResult> {
  const stats = computeExerciseStats(exercises);
  const exercisesJson = JSON.stringify(exercises);
  const existing = db.select().from(workouts).where(eq(workouts.hevyId, hevyId)).get();
  const now = new Date();

  if (existing) {
    db.update(workouts)
      .set({
        title,
        startTime,
        endTime,
        exerciseCount: stats.exerciseCount,
        totalVolumeKg: stats.totalVolumeKg,
        exercisesJson,
        exerciseNames: stats.exerciseNames,
        updatedAt: now,
      })
      .where(eq(workouts.id, existing.id))
      .run();
    // Resyncs the bucket this workout is now in (itself plus any siblings
    // its arrival/edit shifted), then - only if it actually changed title or
    // day - the bucket it left, whose remaining siblings shift back down.
    await resyncDayTitleBucket(title, startTime);
    if (existing.title !== title || dayKeyUTC(existing.startTime) !== dayKeyUTC(startTime)) {
      await resyncDayTitleBucket(existing.title, existing.startTime);
    }
    return { id: existing.id, created: false };
  }

  const inserted = db
    .insert(workouts)
    .values({
      hevyId,
      title,
      startTime,
      endTime,
      exerciseCount: stats.exerciseCount,
      totalVolumeKg: stats.totalVolumeKg,
      exercisesJson,
      exerciseNames: stats.exerciseNames,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await resyncDayTitleBucket(title, startTime);
  return { id: inserted.id, created: true };
}

// Called by hevy/poller.ts for every "deleted" event.
export async function deleteWorkoutByHevyId(hevyId: string): Promise<boolean> {
  const existing = db.select().from(workouts).where(eq(workouts.hevyId, hevyId)).get();
  if (!existing) return false;

  db.delete(workouts).where(eq(workouts.id, existing.id)).run();
  deleteManualRefsForWorkout(existing.id);
  await pushExhibitSync({
    id: toExhibitId(existing.id),
    type: "workout",
    name: existing.title,
    url: `/fitness/workouts/${existing.id}`,
    outgoingRefs: [],
    deleted: true,
  });
  // Remaining siblings in this workout's old title+day bucket move up a
  // rank now that it's gone.
  await resyncDayTitleBucket(existing.title, existing.startTime);
  return true;
}
