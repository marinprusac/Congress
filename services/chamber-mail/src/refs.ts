import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { threadRefs } from "./db/schema.js";
import { parseThreadExhibitId } from "./cache.js";

// Keyed by the thread's exhibit id - threads have no local row id.
const manualRefs = createManualRefs<string>({
  db,
  table: threadRefs,
  ownerColumn: threadRefs.exhibitId,
  ownerKey: "exhibitId",
  targetColumn: threadRefs.targetExhibitId,
});

export function listManualRefs(exhibitId: string): string[] | null {
  if (!parseThreadExhibitId(exhibitId)) return null;
  return manualRefs.listManualRefs(exhibitId);
}

export function addManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseThreadExhibitId(exhibitId)) return false;
  manualRefs.addManualRef(exhibitId, targetExhibitId);
  return true;
}

export function removeManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseThreadExhibitId(exhibitId)) return false;
  manualRefs.removeManualRef(exhibitId, targetExhibitId);
  return true;
}
