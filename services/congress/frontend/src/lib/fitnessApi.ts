// The hevy and health connectors (server: src/connectors/hevy, src/connectors/health).

export type HealthMetricType = "weight" | "vo2Max" | "activeEnergy" | "restingEnergy" | "sleepAsleep";
export interface HealthMetric {
  id: number;
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName: string | null;
}
export type HealthLatest = Partial<Record<HealthMetricType, HealthMetric>>;

export interface RoutineSetInput {
  type: "normal" | "warmup" | "dropset" | "failure";
  weightKg: number | null;
  reps: number | null;
  repRangeStart: number | null;
  repRangeEnd: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}
export interface RoutineExerciseInput {
  exerciseTemplateId: string;
  supersetId: number | null;
  restSeconds: number | null;
  sets: RoutineSetInput[];
}
export interface RoutineExercise extends RoutineExerciseInput {
  name: string;
  sets: (RoutineSetInput & { index: number; rpe: number | null })[];
}
export interface ExerciseTemplate {
  id: string;
  title: string;
  primaryMuscleGroup: string | null;
}
export interface RoutineFolder {
  id: number;
  title: string;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/congress/connectors${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const fetchHealthLatest = () => send<HealthLatest>("/health/latest");
export const fetchHealthSeries = (type: HealthMetricType, limit = 20) => send<HealthMetric[]>(`/health/series/${type}?limit=${limit}`);
export const fetchHealthStatus = () => send<{ hasToken: boolean; lastIngestAt: string | null; samples: number }>("/health/status");
export const newHealthToken = () => send<{ token: string }>("/health/token", { method: "POST" });

export const fetchHevyStatus = () => send<{ hasKey: boolean; lastError: string | null; consecutiveFailures: number; workouts: number; routines: number }>("/hevy/status");
export const saveHevyKey = (apiKey: string | null) => send<{ hasKey: boolean }>("/hevy/settings", { method: "PUT", body: JSON.stringify({ apiKey }) });
export const fetchRoutineFolders = () => send<RoutineFolder[]>("/hevy/folders");
export const searchExerciseTemplates = (q: string) => send<ExerciseTemplate[]>(`/hevy/templates?q=${encodeURIComponent(q)}`);
export const createRoutine = (input: { title: string; folderId: number | null; exercises: RoutineExerciseInput[] }) =>
  send<{ key: string; recordId: string | null }>("/hevy/routines", { method: "POST", body: JSON.stringify(input) });
export const saveRoutineExercises = (key: string, exercises: RoutineExerciseInput[]) =>
  send<{ ok: true }>(`/hevy/routines/${encodeURIComponent(key)}/exercises`, { method: "PUT", body: JSON.stringify({ exercises }) });
