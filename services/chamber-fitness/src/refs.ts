import { createManualRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { workoutRefs } from "./db/schema.js";
import { parseWorkoutId } from "./exhibits.js";

const manualRefs = createManualRefs<number>({
  db,
  table: workoutRefs,
  ownerColumn: workoutRefs.workoutId,
  ownerKey: "workoutId",
  targetColumn: workoutRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForWorkout = manualRefs.deleteManualRefsForOwner;

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("workout-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parseWorkoutId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;
