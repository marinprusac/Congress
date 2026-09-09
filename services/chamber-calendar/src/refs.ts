import { eq } from "drizzle-orm";
import { createManualRefs } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { eventRefs } from "./db/schema.js";
import { parseExhibitId } from "./exhibits.js";

// Unlike chamber-notes/chamber-tasks/chamber-documents, there's no local
// row id to key on - an event isn't stored here, it's fetched live from
// Google - so this is keyed by the full Exhibit id string directly and
// already matches mountManualRefsRoutes' (@congress/chamber-kit) ManualRefsApi
// shape as-is, with no separate "ByExhibitId" wrapper layer needed.
const manualRefs = createManualRefs<string>({
  db,
  table: eventRefs,
  ownerColumn: eventRefs.exhibitId,
  ownerKey: "exhibitId",
  targetColumn: eventRefs.targetExhibitId,
});

export function listManualRefs(exhibitId: string): string[] | null {
  if (!parseExhibitId(exhibitId)) return null;
  return manualRefs.listManualRefs(exhibitId);
}

export function addManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseExhibitId(exhibitId)) return false;
  manualRefs.addManualRef(exhibitId, targetExhibitId);
  return true;
}

export function removeManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseExhibitId(exhibitId)) return false;
  manualRefs.removeManualRef(exhibitId, targetExhibitId);
  return true;
}

export const deleteManualRefsForEvent = manualRefs.deleteManualRefsForOwner;

// Re-keys an event's manual refs onto its new exhibit id after a move (see
// calendar.ts's moveEvent) - a rename in place rather than list+delete+re-add,
// since the new id can never already have rows of its own to conflict with.
export function moveManualRefs(fromExhibitId: string, toExhibitId: string): void {
  db.update(eventRefs).set({ exhibitId: toExhibitId }).where(eq(eventRefs.exhibitId, fromExhibitId)).run();
}
