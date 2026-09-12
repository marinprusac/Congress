import type {
  PersistedWorkoutExercise,
  PersistedWorkoutSet,
  RoutineDetail,
  RoutineExercise,
  RoutineSet,
  RoutineFolder,
  ExerciseTemplate,
  RoutineExerciseInput,
  RoutineSetInput,
} from "../types.js";

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

function normalizeSet(raw: Record<string, unknown>, index: number): PersistedWorkoutSet {
  return {
    index: typeof raw.index === "number" ? raw.index : index,
    weightKg: asNumberOrNull(firstOf(raw, ["weight_kg", "weightKg"])),
    reps: asNumberOrNull(raw.reps),
    durationSeconds: asNumberOrNull(firstOf(raw, ["duration_seconds", "durationSeconds"])),
    distanceMeters: asNumberOrNull(firstOf(raw, ["distance_meters", "distanceMeters"])),
    rpe: asNumberOrNull(raw.rpe),
  };
}

function normalizeExercise(raw: Record<string, unknown>): PersistedWorkoutExercise {
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
  exercises: PersistedWorkoutExercise[];
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

const ROUTINE_SET_TYPES = new Set(["normal", "warmup", "dropset", "failure"]);

function repRangeValue(raw: Record<string, unknown>, key: "start" | "end"): number | null {
  const repRange = (raw.rep_range ?? raw.repRange) as Record<string, unknown> | null | undefined;
  return repRange ? asNumberOrNull(repRange[key]) : null;
}

function normalizeRoutineSet(raw: Record<string, unknown>, index: number): RoutineSet {
  const typeRaw = String(raw.type ?? "normal");
  return {
    index: typeof raw.index === "number" ? raw.index : index,
    type: ROUTINE_SET_TYPES.has(typeRaw) ? (typeRaw as RoutineSet["type"]) : "normal",
    weightKg: asNumberOrNull(firstOf(raw, ["weight_kg", "weightKg"])),
    reps: asNumberOrNull(raw.reps),
    repRangeStart: repRangeValue(raw, "start"),
    repRangeEnd: repRangeValue(raw, "end"),
    durationSeconds: asNumberOrNull(firstOf(raw, ["duration_seconds", "durationSeconds"])),
    distanceMeters: asNumberOrNull(firstOf(raw, ["distance_meters", "distanceMeters"])),
    rpe: asNumberOrNull(raw.rpe),
  };
}

function normalizeRoutineExercise(raw: Record<string, unknown>): RoutineExercise {
  const sets = Array.isArray(raw.sets) ? (raw.sets as Record<string, unknown>[]) : [];
  return {
    exerciseTemplateId: String(firstOf(raw, ["exercise_template_id", "exerciseTemplateId"]) ?? ""),
    name: String(firstOf(raw, ["title", "name"]) ?? "Exercise"),
    // Hevy's own quirk: the request field `superset_id` (singular) comes
    // back as `supersets_id` (plural) in responses - tolerate both here so
    // this normalizer works whether it's ever pointed at a request echo too.
    supersetId: asNumberOrNull(firstOf(raw, ["supersets_id", "superset_id", "supersetsId", "supersetId"])),
    restSeconds: asNumberOrNull(firstOf(raw, ["rest_seconds", "restSeconds"])),
    sets: sets.map(normalizeRoutineSet),
  };
}

export function normalizeRoutine(raw: Record<string, unknown>): RoutineDetail {
  const exercises = Array.isArray(raw.exercises) ? (raw.exercises as Record<string, unknown>[]) : [];
  return {
    id: String(raw.id),
    title: String(raw.title ?? "Untitled routine"),
    folderId: asNumberOrNull(firstOf(raw, ["folder_id", "folderId"])),
    updatedAt: String(firstOf(raw, ["updated_at", "updatedAt"]) ?? new Date().toISOString()),
    createdAt: String(firstOf(raw, ["created_at", "createdAt"]) ?? new Date().toISOString()),
    exercises: exercises.map(normalizeRoutineExercise),
  };
}

export function normalizeRoutineFolder(raw: Record<string, unknown>): RoutineFolder {
  return {
    id: Number(raw.id),
    index: Number(raw.index ?? 0),
    title: String(raw.title ?? "Untitled folder"),
  };
}

export function normalizeExerciseTemplate(raw: Record<string, unknown>): ExerciseTemplate {
  return {
    id: String(raw.id),
    title: String(raw.title ?? "Exercise"),
    primaryMuscleGroup: (firstOf(raw, ["primary_muscle_group", "primaryMuscleGroup"]) as string | undefined) ?? null,
  };
}

// Write-side builders - turn our own request shape into Hevy's wire format.
// `superset_id` is always sent explicitly (even as `null`) rather than
// omitted: a community integrator found that omitting it sends `0` instead,
// which breaks exercise grouping.
function buildHevyRoutineSet(set: RoutineSetInput): Record<string, unknown> {
  return {
    type: set.type,
    weight_kg: set.weightKg,
    reps: set.reps,
    rep_range: set.repRangeStart != null || set.repRangeEnd != null ? { start: set.repRangeStart, end: set.repRangeEnd } : null,
    duration_seconds: set.durationSeconds,
    distance_meters: set.distanceMeters,
    custom_metric: null,
  };
}

function buildHevyRoutineExercise(exercise: RoutineExerciseInput): Record<string, unknown> {
  return {
    exercise_template_id: exercise.exerciseTemplateId,
    superset_id: exercise.supersetId ?? null,
    rest_seconds: exercise.restSeconds,
    sets: exercise.sets.map(buildHevyRoutineSet),
  };
}

export function buildHevyCreateRoutineBody(input: { title: string; folderId: number | null; exercises: RoutineExerciseInput[] }): Record<string, unknown> {
  return {
    title: input.title,
    folder_id: input.folderId,
    exercises: input.exercises.map(buildHevyRoutineExercise),
  };
}

export function buildHevyUpdateRoutineBody(input: { title: string; exercises: RoutineExerciseInput[] }): Record<string, unknown> {
  return {
    title: input.title,
    exercises: input.exercises.map(buildHevyRoutineExercise),
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
