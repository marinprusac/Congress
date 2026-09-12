import { createPushExhibitSync } from "@congress/chamber-kit";
import { env } from "./env.js";
import { getSettings } from "./settings.js";
import { HevyApiError, fetchRoutinesPage, fetchRoutine, fetchRoutineFolders, fetchExerciseTemplatesPage, createRoutine as hevyCreateRoutine, updateRoutine as hevyUpdateRoutine } from "./hevy/client.js";
import {
  normalizeRoutine,
  normalizeRoutineFolder,
  normalizeExerciseTemplate,
  buildHevyCreateRoutineBody,
  buildHevyUpdateRoutineBody,
} from "./hevy/normalize.js";
import type { RoutineSummary, RoutineDetail, RoutineFolder, ExerciseTemplate, CreateRoutineRequest, UpdateRoutineRequest } from "./types.js";

// Every read/write here is a live Hevy call - unlike workouts, routines are
// not locally mirrored (no table, no poller entry). They're a small,
// actively-edited dataset with no delete endpoint on Hevy's side, so
// treating Hevy as the sole live source of truth (rather than a cache that
// could drift or need reconciliation) is simpler and safer than mirroring.
export class RoutinesError extends Error {
  constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "RoutinesError";
  }
}

async function requireApiKey(): Promise<string> {
  const settings = await getSettings();
  if (!settings.hevyApiKey) throw new RoutinesError("hevy_not_configured", "No Hevy API key configured.");
  return settings.hevyApiKey;
}

// A separate instance from exhibits.ts's own pushExhibitSync (rather than
// importing that one) specifically to avoid a routines.ts <-> exhibits.ts
// import cycle: exhibits.ts's routine search/resolve dispatcher (see
// exhibits.ts) needs to call this module's listRoutines/getRoutine, so this
// module can't import back from exhibits.ts. createPushExhibitSync is a
// stateless factory - two independently-created instances with the same
// config behave identically.
const pushRoutineExhibitSync = createPushExhibitSync({
  chamber: "fitness",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

const ROUTINE_EXHIBIT_PREFIX = "routine-";

export function toRoutineExhibitId(hevyId: string): string {
  return `${ROUTINE_EXHIBIT_PREFIX}${hevyId}`;
}

export function parseRoutineExhibitId(exhibitId: string): string | null {
  return exhibitId.startsWith(ROUTINE_EXHIBIT_PREFIX) ? exhibitId.slice(ROUTINE_EXHIBIT_PREFIX.length) : null;
}

async function syncRoutineExhibit(routine: RoutineDetail): Promise<void> {
  // No manual-refs/Connections-panel support for routines in v1 - not
  // requested, so outgoingRefs is always empty (unlike workouts.ts's own
  // syncWorkoutExhibit, which folds in the manual References panel).
  await pushRoutineExhibitSync({
    id: toRoutineExhibitId(routine.id),
    type: "routine",
    name: routine.title,
    url: `/fitness/routines/${routine.id}`,
    outgoingRefs: [],
  });
}

function toSummary(detail: RoutineDetail): RoutineSummary {
  return {
    id: detail.id,
    title: detail.title,
    folderId: detail.folderId,
    updatedAt: detail.updatedAt,
    createdAt: detail.createdAt,
    exerciseCount: detail.exercises.length,
  };
}

export async function listRoutines(): Promise<RoutineSummary[]> {
  const apiKey = await requireApiKey();
  const all: RoutineSummary[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const { routines, pageCount: pc } = await fetchRoutinesPage(apiKey, page);
    pageCount = pc;
    for (const raw of routines) all.push(toSummary(normalizeRoutine(raw as Record<string, unknown>)));
    page += 1;
  } while (page <= pageCount);
  return all;
}

export async function getRoutine(hevyId: string): Promise<RoutineDetail | null> {
  const apiKey = await requireApiKey();
  try {
    const raw = await fetchRoutine(apiKey, hevyId);
    return normalizeRoutine(raw as Record<string, unknown>);
  } catch (err) {
    if (err instanceof HevyApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createRoutine(input: CreateRoutineRequest): Promise<RoutineDetail> {
  const apiKey = await requireApiKey();
  const raw = await hevyCreateRoutine(apiKey, buildHevyCreateRoutineBody(input));

  let routine: RoutineDetail;
  if (raw) {
    routine = normalizeRoutine(raw as Record<string, unknown>);
  } else {
    // Hevy's own response schema documents `POST /routines` as `oneOf
    // [Routine, {}]` - a 201 can come back empty. Recover by matching the
    // just-created routine by title in the full list - best-effort, not
    // guaranteed unique if two routines share a title. Never auto-retry the
    // POST itself here: retrying an ambiguous failure risks a genuine
    // duplicate, and Hevy has no delete endpoint to clean one up.
    const match = (await listRoutines()).find((r) => r.title === input.title);
    const detail = match ? await getRoutine(match.id) : null;
    if (!detail) {
      throw new RoutinesError(
        "routine_created_but_not_found",
        "Hevy accepted the routine but didn't return it - check the Hevy app before retrying."
      );
    }
    routine = detail;
  }

  await syncRoutineExhibit(routine);
  return routine;
}

export async function updateRoutine(hevyId: string, input: UpdateRoutineRequest): Promise<RoutineDetail | null> {
  const apiKey = await requireApiKey();
  let raw: unknown;
  try {
    raw = await hevyUpdateRoutine(apiKey, hevyId, buildHevyUpdateRoutineBody(input));
  } catch (err) {
    if (err instanceof HevyApiError && err.status === 404) return null;
    throw err;
  }
  const routine = normalizeRoutine(raw as Record<string, unknown>);
  await syncRoutineExhibit(routine);
  return routine;
}

export async function listRoutineFolders(): Promise<RoutineFolder[]> {
  const apiKey = await requireApiKey();
  const all: RoutineFolder[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const { folders, pageCount: pc } = await fetchRoutineFolders(apiKey, page);
    pageCount = pc;
    for (const raw of folders) all.push(normalizeRoutineFolder(raw as Record<string, unknown>));
    page += 1;
  } while (page <= pageCount);
  return all;
}

// Hevy has no server-side text search on this endpoint - fetch every page
// (pageSize maxes at 100, and a personal exercise-template catalog is
// bounded) and filter client-side by title.
export async function searchExerciseTemplates(query: string): Promise<ExerciseTemplate[]> {
  const apiKey = await requireApiKey();
  const all: ExerciseTemplate[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const { templates, pageCount: pc } = await fetchExerciseTemplatesPage(apiKey, page);
    pageCount = pc;
    for (const raw of templates) all.push(normalizeExerciseTemplate(raw as Record<string, unknown>));
    page += 1;
  } while (page <= pageCount);
  const q = query.trim().toLowerCase();
  return q ? all.filter((t) => t.title.toLowerCase().includes(q)) : all;
}
