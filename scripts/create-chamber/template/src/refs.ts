import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { itemRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: itemRefs,
  ownerColumn: itemRefs.itemId,
  ownerKey: "itemId",
  targetColumn: itemRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForItem = manualRefs.deleteManualRefsForOwner;
