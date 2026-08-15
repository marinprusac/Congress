import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { noteRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: noteRefs,
  ownerColumn: noteRefs.noteId,
  ownerKey: "noteId",
  targetColumn: noteRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForNote = manualRefs.deleteManualRefsForOwner;
