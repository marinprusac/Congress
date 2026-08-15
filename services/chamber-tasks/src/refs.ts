import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { taskRefs } from "./db/schema.js";

export function listManualRefs(taskId: number): string[] {
  return db
    .select({ targetExhibitId: taskRefs.targetExhibitId })
    .from(taskRefs)
    .where(eq(taskRefs.taskId, taskId))
    .all()
    .map((r) => r.targetExhibitId);
}

export function addManualRef(taskId: number, targetExhibitId: string): void {
  db.insert(taskRefs)
    .values({ taskId, targetExhibitId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function removeManualRef(taskId: number, targetExhibitId: string): void {
  db.delete(taskRefs)
    .where(and(eq(taskRefs.taskId, taskId), eq(taskRefs.targetExhibitId, targetExhibitId)))
    .run();
}

export function deleteManualRefsForTask(taskId: number): void {
  db.delete(taskRefs).where(eq(taskRefs.taskId, taskId)).run();
}
