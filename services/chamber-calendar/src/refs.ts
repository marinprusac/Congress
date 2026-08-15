import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { eventRefs } from "./db/schema.js";
import { parseExhibitId } from "./exhibits.js";

// Unlike chamber-notes/chamber-tasks/chamber-documents, there's no local
// row id to key on - an event isn't stored here, it's fetched live from
// Google - so these are keyed by the full Exhibit id string directly and
// already match mountManualRefsRoutes' (@congress/chamber-kit) ManualRefsApi
// shape as-is, with no separate "ByExhibitId" wrapper layer needed.
export function listManualRefs(exhibitId: string): string[] | null {
  if (!parseExhibitId(exhibitId)) return null;
  return db
    .select({ targetExhibitId: eventRefs.targetExhibitId })
    .from(eventRefs)
    .where(eq(eventRefs.exhibitId, exhibitId))
    .all()
    .map((r) => r.targetExhibitId);
}

export function addManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseExhibitId(exhibitId)) return false;
  db.insert(eventRefs)
    .values({ exhibitId, targetExhibitId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
  return true;
}

export function removeManualRef(exhibitId: string, targetExhibitId: string): boolean {
  if (!parseExhibitId(exhibitId)) return false;
  db.delete(eventRefs)
    .where(and(eq(eventRefs.exhibitId, exhibitId), eq(eventRefs.targetExhibitId, targetExhibitId)))
    .run();
  return true;
}

export function deleteManualRefsForEvent(exhibitId: string): void {
  db.delete(eventRefs).where(eq(eventRefs.exhibitId, exhibitId)).run();
}
