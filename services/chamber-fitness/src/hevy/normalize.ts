import type { WorkoutExercise, WorkoutSet } from "../types.js";

// Same "confirm against real data" caveat as client.ts: Hevy's set/workout
// field names below (weight_kg, distance_meters, ...) come from public
// community documentation of GET responses, but a couple of fields have
// been seen written in camelCase in write-request examples elsewhere in
// that same documentation - `firstOf` tolerates either spelling rather than
// assuming one is authoritative.
function firstOf(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  }
  return undefined;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

const SET_TYPES = new Set(["normal", "warmup", "dropset", "failure"]);

function normalizeSet(raw: Record<string, unknown>, index: number): WorkoutSet {
  const typeRaw = String(raw.type ?? "normal");
  return {
    index: typeof raw.index === "number" ? raw.index : index,
    type: SET_TYPES.has(typeRaw) ? (typeRaw as WorkoutSet["type"]) : "normal",
    weightKg: asNumberOrNull(firstOf(raw, ["weight_kg", "weightKg"])),
    reps: asNumberOrNull(raw.reps),
    durationSeconds: asNumberOrNull(firstOf(raw, ["duration_seconds", "durationSeconds"])),
    distanceMeters: asNumberOrNull(firstOf(raw, ["distance_meters", "distanceMeters"])),
    rpe: asNumberOrNull(raw.rpe),
  };
}

function normalizeExercise(raw: Record<string, unknown>): WorkoutExercise {
  const sets = Array.isArray(raw.sets) ? (raw.sets as Record<string, unknown>[]) : [];
  return {
    name: String(firstOf(raw, ["title", "name"]) ?? "Exercise"),
    sets: sets.map(normalizeSet),
  };
}

export interface NormalizedHevyWorkout {
  hevyId: string;
  title: string;
  startTime: string;
  endTime: string;
  exercises: WorkoutExercise[];
}

export function normalizeHevyWorkout(raw: Record<string, unknown>): NormalizedHevyWorkout {
  const exercises = Array.isArray(raw.exercises) ? (raw.exercises as Record<string, unknown>[]) : [];
  return {
    hevyId: String(raw.id),
    title: String(raw.title ?? "Untitled workout"),
    startTime: String(firstOf(raw, ["start_time", "startTime"]) ?? new Date().toISOString()),
    endTime: String(firstOf(raw, ["end_time", "endTime"]) ?? new Date().toISOString()),
    exercises: exercises.map(normalizeExercise),
  };
}

export interface InterpretedHevyEvent {
  kind: "updated" | "deleted";
  hevyId: string;
  workout: Record<string, unknown> | null;
  timestamp: string;
}

// Turns one raw /v1/workouts/events entry into the shape the poller needs.
// A "deleted" event is assumed to carry an id but no workout body; an
// "updated" event may or may not embed the full workout inline (the poller
// falls back to GET /v1/workouts/{id} when it doesn't).
export function interpretHevyEvent(raw: Record<string, unknown>): InterpretedHevyEvent {
  const workout = (raw.workout ?? null) as Record<string, unknown> | null;
  const kindRaw = String(raw.type ?? (workout ? "updated" : "deleted"));
  const kind: InterpretedHevyEvent["kind"] = kindRaw === "deleted" ? "deleted" : "updated";
  const hevyId = String(workout?.id ?? raw.id ?? raw.workout_id ?? "");
  const timestamp = String(firstOf(raw, ["updated_at", "deleted_at"]) ?? firstOf(workout ?? {}, ["updated_at"]) ?? new Date().toISOString());
  return { kind, hevyId, workout, timestamp };
}
