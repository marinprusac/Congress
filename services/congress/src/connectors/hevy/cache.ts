import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { SourceRecord } from "../contract.js";
import { hevyDb as db } from "./db/client.js";
import { folders, routines, settings, workouts } from "./db/schema.js";
import { persistedWorkoutExerciseSchema, routineExerciseSchema, type PersistedWorkoutExercise, type RoutineDetail, type RoutineExercise, type RoutineFolder } from "./types.js";
import { computeOneRepMax } from "./oneRepMax.js";
import { ownerZone } from "../../typeEngine/zone.js";

type WorkoutRow = typeof workouts.$inferSelect;
type RoutineRow = typeof routines.$inferSelect;

// --- workouts

function stats(exercises: PersistedWorkoutExercise[]) {
  let volume: number | null = null;
  for (const e of exercises) for (const s of e.sets) if (s.weightKg != null && s.reps != null) volume = (volume ?? 0) + s.weightKg * s.reps;
  return { exerciseCount: exercises.length, totalVolumeKg: volume, exerciseNames: exercises.map((e) => e.name).join(", ") };
}

// Returns whether it was new.
export function upsertWorkout(w: { hevyId: string; title: string; startTime: string; endTime: string; exercises: PersistedWorkoutExercise[] }): boolean {
  const existed = Boolean(getWorkoutRow(w.hevyId));
  const row = {
    hevyId: w.hevyId,
    title: w.title,
    startTime: Date.parse(w.startTime),
    endTime: Date.parse(w.endTime),
    ...stats(w.exercises),
    exercisesJson: JSON.stringify(w.exercises),
    updatedAt: new Date(),
  };
  db.insert(workouts).values(row).onConflictDoUpdate({ target: workouts.hevyId, set: row }).run();
  return !existed;
}

export const removeWorkout = (hevyId: string) => db.delete(workouts).where(eq(workouts.hevyId, hevyId)).run().changes > 0;
export const getWorkoutRow = (hevyId: string): WorkoutRow | undefined => db.select().from(workouts).where(eq(workouts.hevyId, hevyId)).get();

export function listWorkoutRows(opts: { from?: string; to?: string } = {}): WorkoutRow[] {
  const conds = [opts.from ? gte(workouts.endTime, Date.parse(opts.from)) : undefined, opts.to ? lte(workouts.startTime, Date.parse(opts.to)) : undefined].filter(
    (c) => c !== undefined
  );
  return db.select().from(workouts).where(conds.length ? and(...conds) : undefined).orderBy(desc(workouts.startTime)).all();
}

// "Push Day · Sep 5, 2026": Hevy titles repeat, so the day tells them apart.
export function workoutName(title: string, startMs: number, zone = ownerZone()): string {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(startMs);
  return `${title} · ${day}`;
}

export function workoutRecord(row: WorkoutRow): SourceRecord {
  return {
    kind: "workout",
    key: row.hevyId,
    values: {
      title: workoutName(row.title, row.startTime),
      start: new Date(row.startTime).toISOString(),
      end: new Date(row.endTime).toISOString(),
      exercises: row.exerciseNames,
      exerciseCount: row.exerciseCount,
      volumeKg: row.totalVolumeKg === null ? null : Math.round(row.totalVolumeKg),
    },
    facts: {},
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseExercises(json: string): PersistedWorkoutExercise[] {
  const parsed = persistedWorkoutExerciseSchema.array().safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : [];
}

// Every set with its estimated 1RM, for the workout's live view.
export function workoutDetail(hevyId: string) {
  const row = getWorkoutRow(hevyId);
  if (!row) return null;
  return {
    title: row.title,
    volumeKg: row.totalVolumeKg,
    exercises: parseExercises(row.exercisesJson).map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, oneRepMax: computeOneRepMax(s.weightKg, s.reps) })) })),
  };
}

// --- routines

export function upsertRoutine(r: RoutineDetail): void {
  const row = { hevyId: r.id, title: r.title, folderId: r.folderId, exercisesJson: JSON.stringify(r.exercises), hevyUpdatedAt: r.updatedAt, updatedAt: new Date() };
  db.insert(routines).values(row).onConflictDoUpdate({ target: routines.hevyId, set: row }).run();
}

export const removeRoutine = (hevyId: string) => db.delete(routines).where(eq(routines.hevyId, hevyId)).run().changes > 0;
export const getRoutineRow = (hevyId: string): RoutineRow | undefined => db.select().from(routines).where(eq(routines.hevyId, hevyId)).get();
export const listRoutineRows = (): RoutineRow[] => db.select().from(routines).orderBy(routines.title).all();

export function routineExercises(row: RoutineRow): RoutineExercise[] {
  const parsed = routineExerciseSchema.array().safeParse(JSON.parse(row.exercisesJson));
  return parsed.success ? parsed.data : [];
}

export function routineRecord(row: RoutineRow): SourceRecord {
  const exercises = routineExercises(row);
  const folder = row.folderId === null ? null : db.select().from(folders).where(eq(folders.id, row.folderId)).get();
  return {
    kind: "routine",
    key: row.hevyId,
    values: {
      title: row.title,
      folder: folder?.title ?? "",
      exercises: exercises.map((e) => `${e.name} × ${e.sets.length}`).join(", "),
      exerciseCount: exercises.length,
    },
    facts: {},
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function storeFolders(list: RoutineFolder[]): void {
  db.transaction((tx) => {
    tx.delete(folders).run();
    for (const f of list) tx.insert(folders).values({ id: f.id, title: f.title, position: f.index }).run();
  });
}

export const listFolders = () => db.select().from(folders).orderBy(folders.position).all();

// --- settings

export type HevySettings = typeof settings.$inferSelect;

export function getHevySettings(): HevySettings {
  return db.select().from(settings).where(eq(settings.id, 1)).get() ?? { id: 1, apiKey: null, cursor: null, consecutiveFailures: 0, lastError: null, publishEvents: false };
}

export function updateHevySettings(patch: Partial<Omit<HevySettings, "id">>): HevySettings {
  const next = { ...getHevySettings(), ...patch, id: 1 };
  db.insert(settings).values(next).onConflictDoUpdate({ target: settings.id, set: next }).run();
  return next;
}
