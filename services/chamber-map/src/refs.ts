import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { placeRefs } from "./db/schema.js";

const manualRefs = createManualRefs<number>({
  db,
  table: placeRefs,
  ownerColumn: placeRefs.placeId,
  ownerKey: "placeId",
  targetColumn: placeRefs.targetExhibitId,
});

export const listManualRefs = manualRefs.listManualRefs;
export const addManualRef = manualRefs.addManualRef;
export const removeManualRef = manualRefs.removeManualRef;
export const deleteManualRefsForPlace = manualRefs.deleteManualRefsForOwner;
