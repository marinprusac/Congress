import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { documentRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: documentRefs,
  ownerColumn: documentRefs.documentId,
  ownerKey: "documentId",
  targetColumn: documentRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForDocument = manualRefs.deleteManualRefsForOwner;
