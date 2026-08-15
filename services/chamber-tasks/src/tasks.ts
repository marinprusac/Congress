import { desc, eq, like, or } from "drizzle-orm";
import type { TaskSummary, TaskDetail, CreateTaskRequest, UpdateTaskRequest } from "@congress/shared-types";
import { parseExhibitToken } from "@congress/shared-types";
import { db } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { toExhibitId, pushExhibitSync } from "./exhibits.js";

// Same regex+parseExhibitToken-filter shape as chamber-notes/src/notes.ts,
// chamber-documents/src/documents.ts, and chamber-calendar/src/exhibits.ts's
// extractOutgoingExhibitRefs - kept as its own small per-chamber copy rather
// than shared, per established precedent.
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
function extractOutgoingExhibitRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
}

function toSummary(row: typeof tasks.$inferSelect): TaskSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completed: row.completed,
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
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await pushExhibitSync({
    id: toExhibitId(inserted.id),
    type: "task",
    name: inserted.name,
    url: `/t/${inserted.id}`,
    outgoingRefs: extractOutgoingExhibitRefs(inserted.description),
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
    updatedAt: new Date(),
  };

  db.update(tasks).set(next).where(eq(tasks.id, id)).run();

  await pushExhibitSync({
    id: toExhibitId(id),
    type: "task",
    name: next.name,
    url: `/t/${id}`,
    outgoingRefs: extractOutgoingExhibitRefs(next.description),
  });

  return getTask(id);
}

export async function deleteTask(id: number): Promise<boolean> {
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes > 0 && existing) {
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "task",
      name: existing.name,
      url: `/t/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
  }
  return result.changes > 0;
}
