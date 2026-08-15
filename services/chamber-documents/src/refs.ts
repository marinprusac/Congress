import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { documentRefs } from "./db/schema.js";

export function listManualRefs(documentId: number): string[] {
  return db
    .select({ targetExhibitId: documentRefs.targetExhibitId })
    .from(documentRefs)
    .where(eq(documentRefs.documentId, documentId))
    .all()
    .map((r) => r.targetExhibitId);
}

export function addManualRef(documentId: number, targetExhibitId: string): void {
  db.insert(documentRefs)
    .values({ documentId, targetExhibitId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function removeManualRef(documentId: number, targetExhibitId: string): void {
  db.delete(documentRefs)
    .where(and(eq(documentRefs.documentId, documentId), eq(documentRefs.targetExhibitId, targetExhibitId)))
    .run();
}

export function deleteManualRefsForDocument(documentId: number): void {
  db.delete(documentRefs).where(eq(documentRefs.documentId, documentId)).run();
}
