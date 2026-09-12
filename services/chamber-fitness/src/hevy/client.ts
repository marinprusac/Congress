const HEVY_BASE_URL = "https://api.hevyapp.com/v1";

export class HevyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "HevyApiError";
  }
}

interface HevyFetchOptions {
  method?: string;
  params?: Record<string, string | number>;
  body?: unknown;
}

async function hevyFetch(apiKey: string, path: string, opts: HevyFetchOptions = {}): Promise<unknown> {
  const url = new URL(`${HEVY_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(opts.params ?? {})) url.searchParams.set(key, String(value));

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "api-key": apiKey,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    throw new HevyApiError(`Hevy API request failed: ${res.status} ${res.statusText}`, res.status);
  }
  // POST /v1/routines can legitimately return `{}` on success (Hevy's own
  // response schema documents this as a possible shape) - an empty body
  // parses fine as `{}` here; callers that need to distinguish "created,
  // but Hevy didn't echo it back" handle that themselves.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export interface RawHevyEventsPage {
  events: unknown[];
  pageCount: number;
}

// Hevy's exact response envelope for this endpoint isn't fully pinned down
// by public docs at the time this was written (community sources agree on
// the page/pageSize/since query params and on "updated"/"deleted" event
// types, not on the wrapping object's exact key names) - tolerate a couple
// of plausible key names rather than assuming one, and confirm/simplify
// this against a real response once a Hevy Pro key is available.
export async function fetchWorkoutEventsPage(apiKey: string, since: string, page: number, pageSize = 10): Promise<RawHevyEventsPage> {
  const body = (await hevyFetch(apiKey, "/workouts/events", { params: { since, page, pageSize } })) as Record<string, unknown>;
  const events = (body.events ?? body.workout_events ?? []) as unknown[];
  const pageCount = Number(body.page_count ?? body.pageCount ?? 1);
  return { events, pageCount };
}

export async function fetchWorkout(apiKey: string, hevyId: string): Promise<unknown> {
  const body = (await hevyFetch(apiKey, `/workouts/${hevyId}`)) as Record<string, unknown>;
  return body.workout ?? body;
}

export interface RawRoutinesPage {
  routines: unknown[];
  pageCount: number;
}

export async function fetchRoutinesPage(apiKey: string, page: number, pageSize = 10): Promise<RawRoutinesPage> {
  const body = (await hevyFetch(apiKey, "/routines", { params: { page, pageSize } })) as Record<string, unknown>;
  return { routines: (body.routines ?? []) as unknown[], pageCount: Number(body.page_count ?? 1) };
}

export async function fetchRoutine(apiKey: string, routineId: string): Promise<unknown> {
  const body = (await hevyFetch(apiKey, `/routines/${routineId}`)) as Record<string, unknown>;
  return body.routine ?? body;
}

// Hevy's own response schema documents this endpoint as `oneOf [Routine, {}]`
// - a 201 can come back with no created object at all. Returns null in that
// case rather than throwing; the caller (routines.ts) owns recovering the
// created routine's identity.
export async function createRoutine(apiKey: string, routine: unknown): Promise<unknown | null> {
  const body = (await hevyFetch(apiKey, "/routines", { method: "POST", body: { routine } })) as Record<string, unknown>;
  if (Object.keys(body).length === 0) return null;
  return body.routine ?? body;
}

// PUT is a full replace, not a patch - callers must send the complete
// exercise/set tree every time, per Hevy's own documented semantics.
export async function updateRoutine(apiKey: string, routineId: string, routine: unknown): Promise<unknown> {
  const body = (await hevyFetch(apiKey, `/routines/${routineId}`, { method: "PUT", body: { routine } })) as Record<string, unknown>;
  return body.routine ?? body;
}

export interface RawRoutineFoldersPage {
  folders: unknown[];
  pageCount: number;
}

export async function fetchRoutineFolders(apiKey: string, page: number, pageSize = 10): Promise<RawRoutineFoldersPage> {
  const body = (await hevyFetch(apiKey, "/routine_folders", { params: { page, pageSize } })) as Record<string, unknown>;
  return { folders: (body.routine_folders ?? []) as unknown[], pageCount: Number(body.page_count ?? 1) };
}

export interface RawExerciseTemplatesPage {
  templates: unknown[];
  pageCount: number;
}

export async function fetchExerciseTemplatesPage(apiKey: string, page: number, pageSize = 100): Promise<RawExerciseTemplatesPage> {
  const body = (await hevyFetch(apiKey, "/exercise_templates", { params: { page, pageSize } })) as Record<string, unknown>;
  return { templates: (body.exercise_templates ?? []) as unknown[], pageCount: Number(body.page_count ?? 1) };
}
