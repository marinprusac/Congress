import { ConnectorRefusedError, type ConnectorContext, type SourceRecord } from "../contract.js";
import { createRoutine as hevyCreate, fetchExerciseTemplatesPage, updateRoutine as hevyUpdate } from "./client.js";
import { buildHevyCreateRoutineBody, buildHevyUpdateRoutineBody, normalizeExerciseTemplate, normalizeRoutine } from "./normalize.js";
import { getHevySettings, getRoutineRow, routineExercises, routineRecord, upsertRoutine } from "./cache.js";
import { fetchAllRoutines } from "./sync.js";
import type { CreateRoutineInput, ExerciseTemplate, RoutineDetail, RoutineExerciseInput } from "./types.js";

// Writes to Hevy. Hevy can't delete a routine, so a create is never retried:
// a duplicate would be permanent.

function apiKey(): string {
  const key = getHevySettings().apiKey;
  if (!key) throw new ConnectorRefusedError("No Hevy API key set (Settings → Connectors)");
  return key;
}

function stored(ctx: ConnectorContext, r: RoutineDetail): SourceRecord {
  upsertRoutine(r);
  ctx.emitChange("routine", r.id);
  return routineRecord(getRoutineRow(r.id)!);
}

export async function createRoutine(ctx: ConnectorContext, input: CreateRoutineInput): Promise<SourceRecord> {
  const key = apiKey();
  const raw = await hevyCreate(key, buildHevyCreateRoutineBody(input));
  // Hevy may accept it and answer {}: find it by title instead.
  const routine = raw
    ? normalizeRoutine(raw as Record<string, unknown>)
    : (await fetchAllRoutines(key)).find((r) => r.title === input.title && !getRoutineRow(r.id));
  if (!routine) throw new Error("Hevy accepted the routine but didn't return it - check the Hevy app before trying again.");
  return stored(ctx, routine);
}

const asInput = (row: NonNullable<ReturnType<typeof getRoutineRow>>): RoutineExerciseInput[] =>
  routineExercises(row).map((e) => ({
    exerciseTemplateId: e.exerciseTemplateId,
    supersetId: e.supersetId,
    restSeconds: e.restSeconds,
    sets: e.sets.map((s) => ({
      type: s.type,
      weightKg: s.weightKg,
      reps: s.reps,
      repRangeStart: s.repRangeStart,
      repRangeEnd: s.repRangeEnd,
      durationSeconds: s.durationSeconds,
      distanceMeters: s.distanceMeters,
    })),
  }));

// Hevy's PUT replaces the whole routine: title and every exercise.
export async function updateRoutine(ctx: ConnectorContext, hevyId: string, change: { title?: string; exercises?: RoutineExerciseInput[] }): Promise<SourceRecord> {
  const row = getRoutineRow(hevyId);
  if (!row) throw new ConnectorRefusedError("That routine is gone from Hevy");
  const raw = await hevyUpdate(apiKey(), hevyId, buildHevyUpdateRoutineBody({ title: change.title ?? row.title, exercises: change.exercises ?? asInput(row) }));
  return stored(ctx, normalizeRoutine(raw as Record<string, unknown>));
}

let templates: { at: number; list: ExerciseTemplate[] } | null = null;

// Hevy has no template search: every page, cached for an hour, filtered here.
export async function searchExerciseTemplates(query: string): Promise<ExerciseTemplate[]> {
  if (!templates || Date.now() - templates.at > 3_600_000) {
    const key = apiKey();
    const list: ExerciseTemplate[] = [];
    let page = 1;
    let pageCount = 1;
    do {
      const res = await fetchExerciseTemplatesPage(key, page);
      pageCount = res.pageCount;
      list.push(...res.templates.map((t) => normalizeExerciseTemplate(t as Record<string, unknown>)));
      page++;
    } while (page <= pageCount);
    templates = { at: Date.now(), list };
  }
  const q = query.trim().toLowerCase();
  return q ? templates.list.filter((t) => t.title.toLowerCase().includes(q)) : templates.list;
}
