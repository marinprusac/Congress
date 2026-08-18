import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { directiveRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: directiveRefs,
  ownerColumn: directiveRefs.directiveId,
  ownerKey: "directiveId",
  targetColumn: directiveRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForDirective = manualRefs.deleteManualRefsForOwner;
