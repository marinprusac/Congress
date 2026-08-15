import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { noteRefs } from "./db/schema.js";

export function listManualRefs(noteId: number): string[] {
  return db
    .select({ targetExhibitId: noteRefs.targetExhibitId })
    .from(noteRefs)
    .where(eq(noteRefs.noteId, noteId))
    .all()
    .map((r) => r.targetExhibitId);
}

export function addManualRef(noteId: number, targetExhibitId: string): void {
  db.insert(noteRefs)
    .values({ noteId, targetExhibitId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function removeManualRef(noteId: number, targetExhibitId: string): void {
  db.delete(noteRefs)
    .where(and(eq(noteRefs.noteId, noteId), eq(noteRefs.targetExhibitId, targetExhibitId)))
    .run();
}

export function deleteManualRefsForNote(noteId: number): void {
  db.delete(noteRefs).where(eq(noteRefs.noteId, noteId)).run();
}
