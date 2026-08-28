import { like, or, inArray, desc } from "drizzle-orm";
import { createTableBackedExhibits, createPushExhibitSync } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { workouts } from "./db/schema.js";
import { env } from "./env.js";

// Unlike chamber-calendar's hand-rolled exhibits.ts, Hevy sync already
// mirrors every workout into `workouts` locally, so this Chamber can use the
// same table-backed pattern as notes/documents - no live-fetch-on-miss
// branch needed.
const exhibits = createTableBackedExhibits({
  idPrefix: "workout-",
  type: "workout",
  urlFor: (id: number) => `/fitness/workouts/${id}`,
  searchRows: (pattern, limit) =>
    db
      .select({ id: workouts.id, title: workouts.title })
      .from(workouts)
      .where(or(like(workouts.title, pattern), like(workouts.exerciseNames, pattern)))
      .orderBy(desc(workouts.startTime))
      .limit(limit)
      .all(),
  resolveRows: (ids) => db.select({ id: workouts.id, title: workouts.title }).from(workouts).where(inArray(workouts.id, ids)).all(),
});

export const toExhibitId = exhibits.toExhibitId;
export const parseWorkoutId = exhibits.parseId;
export const searchWorkoutExhibits = exhibits.search;
export const resolveWorkoutExhibits = exhibits.resolve;

export const pushExhibitSync = createPushExhibitSync({
  chamber: "fitness",
  capitolUrl: env.CAPITOL_URL,
  internalToken: env.CONGRESS_INTERNAL_TOKEN,
});
