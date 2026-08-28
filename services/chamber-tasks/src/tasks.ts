import { desc, eq, like, or } from "drizzle-orm";
import type { TaskSummary, TaskDetail, CreateTaskRequest, UpdateTaskRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { toExhibitId, parseTaskId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForTask } from "./refs.js";
import { reschedule, publishEvent } from "./notifications.js";

// The set of Exhibits this task points at is the union of what's embedded
// in its description ("[[" tokens) and what was added explicitly via the
// References side panel - pushed to Capitol as one outgoingRefs list
// either way. Same shape as chamber-notes/src/notes.ts's syncNoteExhibit.
async function syncTaskExhibit(id: number, name: string, description: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(description), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "task",
    name,
    url: `/t/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a task whose description didn't change but whose manual refs
// did (see the /api/exhibits/:id/refs routes in server.ts).
export async function resyncTaskExhibit(id: number): Promise<void> {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!row) return;
  await syncTaskExhibit(id, row.name, row.description);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("task-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parseTaskId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncTaskExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseTaskId(exhibitId);
  if (id !== null) await resyncTaskExhibit(id);
}

function toSummary(row: typeof tasks.$inferSelect): TaskSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completed: row.completed,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTasks(): Promise<TaskSummary[]> {
  const rows = db.select().from(tasks).orderBy(desc(tasks.updatedAt)).all();
  return rows.map(toSummary);
}

// Incomplete tasks, soonest due date first (nulls last) - powers the
// homepage widget, the equivalent of Notes' "pinned" list.
export async function listOpenTasks(): Promise<TaskSummary[]> {
  const rows = db.select().from(tasks).where(eq(tasks.completed, false)).all();
  return rows
    .map(toSummary)
    .sort((a, b) => {
      if (a.dueDate === null && b.dueDate === null) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
}

export async function searchTasks(query: string): Promise<TaskSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(tasks)
    .where(or(like(tasks.name, pattern), like(tasks.description, pattern)))
    .orderBy(desc(tasks.updatedAt))
    .all();
  return rows.map(toSummary);
}

export async function getTask(id: number): Promise<TaskDetail | null> {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
  return row ? toSummary(row) : null;
}

export async function createTask(input: CreateTaskRequest): Promise<TaskDetail> {
  const now = new Date();
  const inserted = db
    .insert(tasks)
    .values({
      name: input.name,
      description: input.description,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      priority: input.priority,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncTaskExhibit(inserted.id, inserted.name, inserted.description);
  reschedule();
  void publishEvent({
    type: "tasks.created",
    payload: { taskId: inserted.id, name: inserted.name, url: `/t/${inserted.id}` },
  });

  return toSummary(inserted);
}

export async function updateTask(id: number, input: UpdateTaskRequest): Promise<TaskDetail | null> {
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;

  const next = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate ? new Date(input.dueDate) : null,
    completed: input.completed ?? existing.completed,
    priority: input.priority ?? existing.priority,
    updatedAt: new Date(),
  };

  db.update(tasks).set(next).where(eq(tasks.id, id)).run();

  await syncTaskExhibit(id, next.name, next.description);
  reschedule();

  const url = `/t/${id}`;
  void publishEvent({ type: "tasks.updated", payload: { taskId: id, name: next.name, url } });
  if (!existing.completed && next.completed) {
    void publishEvent({ type: "tasks.completed", payload: { taskId: id, name: next.name, url } });
  } else if (existing.completed && !next.completed) {
    void publishEvent({ type: "tasks.reopened", payload: { taskId: id, name: next.name, url } });
  }

  return getTask(id);
}

export async function deleteTask(id: number): Promise<boolean> {
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForTask(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "task",
      name: existing.name,
      url: `/t/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
    reschedule();
    void publishEvent({ type: "tasks.deleted", payload: { taskId: id, name: existing.name } });
  }
  return result.changes > 0;
}
