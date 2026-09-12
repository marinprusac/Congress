import type { ExhibitSearchResult, ExhibitResolveResult } from "@congress/shared-types";
import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync, scoreExhibitMatch } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { env } from "./env.js";
import { composeExhibitTitle } from "./workoutTitle.js";
import { getSettings } from "./settings.js";
import { listRoutines, getRoutine, toRoutineExhibitId, parseRoutineExhibitId } from "./routines.js";

// Unlike chamber-calendar's hand-rolled exhibits.ts, Hevy sync already
// mirrors every workout into `workouts` locally, so this Chamber can use the
// same table-backed pattern as notes/documents - no live-fetch-on-miss
// branch needed. `title` here is the composed "<name> · <date>" Exhibit
// title (see workoutTitle.ts), not the raw Hevy title stored on the row -
// Hevy titles repeat across sessions and wouldn't be unique per Exhibit.
//
// Routines (below) are the opposite case - Hevy-backed, not locally
// mirrored - so this module's own exported `search`/`resolve` (see the
// bottom of this file) are a small dispatcher merging this table-backed
// source with a hand-rolled live one, rather than a single passthrough of
// one createTableBackedExhibits call the way every other Chamber's
// exhibits.ts is.
const workoutExhibits = createTableBackedExhibits({
  idPrefix: "workout-",
  type: "workout",
  urlFor: (id: number) => `/fitness/workouts/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({
        id: workouts.id,
        title: workouts.title,
        startTime: workouts.startTime,
        exerciseNames: workouts.exerciseNames,
      })
      .from(workouts)
      .where(or(like(workouts.title, pattern), like(workouts.exerciseNames, pattern)))
      .orderBy(desc(workouts.startTime))
      .limit(limit)
      .all()
      .map((row) => ({
        id: row.id,
        title: composeExhibitTitle(row.id, row.title, row.startTime),
        body: row.exerciseNames,
      })),
  resolveRows: (ids) =>
    db
      .select({
        id: workouts.id,
        title: workouts.title,
        startTime: workouts.startTime,
        exerciseNames: workouts.exerciseNames,
      })
      .from(workouts)
      .where(inArray(workouts.id, ids))
      .all()
      .map((row) => ({
        id: row.id,
        title: composeExhibitTitle(row.id, row.title, row.startTime),
        body: row.exerciseNames,
      })),
});

export const toExhibitId = workoutExhibits.toExhibitId;
export const parseWorkoutId = workoutExhibits.parseId;
// Kept exported under their original names (aliases to the table-backed
// instance's own methods) since exhibits.test.ts imports these directly -
// the dispatcher refactor below must not change this file's existing
// public surface for workouts.
export const searchWorkoutExhibits = workoutExhibits.search;
export const resolveWorkoutExhibits = workoutExhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "fitness",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});

// Routines are Hevy-backed, not a local table - styled directly on
// chamber-calendar's own hand-rolled exhibits.ts (the precedent for a
// non-table-backed, live-external-API exhibit source in this codebase).
// Degrades to no results (never throws) on any failure, including "no Hevy
// key configured" - a routine search miss shouldn't take down workout
// search or bubble up as an error to Congress's own fan-out.
async function searchRoutineExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const settings = await getSettings();
  if (!settings.hevyApiKey) return [];
  try {
    const routines = await listRoutines();
    const trimmedQuery = query.trim();
    const ranked = trimmedQuery
      ? routines
          .map((routine) => ({ routine, score: scoreExhibitMatch(trimmedQuery, [{ text: routine.title, isPrimary: true }]) }))
          .sort((a, b) => b.score - a.score)
      : routines.map((routine) => ({ routine, score: undefined as number | undefined }));
    return ranked.slice(0, limit).map(({ routine, score }) => ({
      id: toRoutineExhibitId(routine.id),
      type: "routine",
      name: routine.title,
      url: `/fitness/routines/${routine.id}`,
      ...(score !== undefined ? { score } : {}),
    }));
  } catch {
    return [];
  }
}

async function resolveRoutineExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ExhibitResolveResult> => {
      const hevyId = parseRoutineExhibitId(id);
      if (!hevyId) return { id, deleted: true };
      try {
        const routine = await getRoutine(hevyId);
        return routine ? { id, name: routine.title, url: `/fitness/routines/${routine.id}` } : { id, deleted: true };
      } catch {
        // Same "resolve only distinguishes resolved/deleted" tolerance as
        // chamber-calendar's own resolveEventExhibits - covers a real 404
        // and a misconfigured/unreachable Hevy account alike.
        return { id, deleted: true };
      }
    })
  );
}

// The dispatcher: merges the table-backed workout source with the hand-
// rolled routine source, since mountExhibitSearchRoutes takes exactly one
// {search, resolve} pair per Chamber.
export async function search(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const [workoutResult, routineResult] = await Promise.allSettled([
    workoutExhibits.search(query, limit),
    searchRoutineExhibits(query, limit),
  ]);
  const workoutMatches = workoutResult.status === "fulfilled" ? workoutResult.value : [];
  const routineMatches = routineResult.status === "fulfilled" ? routineResult.value : [];
  // Array.prototype.sort is stable, so entries with no `score` (an empty
  // query, where each source is already recency-ordered) keep their
  // relative position - workouts before routines - rather than being
  // reshuffled by this merge.
  return [...workoutMatches, ...routineMatches].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, limit);
}

export async function resolve(ids: string[]): Promise<ExhibitResolveResult[]> {
  const workoutIds = ids.filter((id) => parseWorkoutId(id) !== null);
  const routineIds = ids.filter((id) => parseRoutineExhibitId(id) !== null);
  const [workoutResolved, routineResolved] = await Promise.all([
    workoutIds.length ? workoutExhibits.resolve(workoutIds) : Promise.resolve([]),
    routineIds.length ? resolveRoutineExhibits(routineIds) : Promise.resolve([]),
  ]);
  const byId = new Map([...workoutResolved, ...routineResolved].map((r) => [r.id, r]));
  // Recombine in input order, mirroring how Congress's own resolveExhibits
  // recombines results it split by chamber.
  return ids.map((id) => byId.get(id) ?? { id, deleted: true });
}
