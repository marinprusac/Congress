import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { logRuleRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: logRuleRefs,
  ownerColumn: logRuleRefs.logRuleId,
  ownerKey: "logRuleId",
  targetColumn: logRuleRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForLogRule = manualRefs.deleteManualRefsForOwner;
