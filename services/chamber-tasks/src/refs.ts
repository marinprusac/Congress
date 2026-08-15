import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { taskRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: taskRefs,
  ownerColumn: taskRefs.taskId,
  ownerKey: "taskId",
  targetColumn: taskRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForTask = manualRefs.deleteManualRefsForOwner;
