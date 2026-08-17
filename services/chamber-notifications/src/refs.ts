import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { automationRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: automationRefs,
  ownerColumn: automationRefs.automationId,
  ownerKey: "automationId",
  targetColumn: automationRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForAutomation = manualRefs.deleteManualRefsForOwner;
