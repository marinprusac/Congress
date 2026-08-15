import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Explicit references added from the task's "References" side panel, kept
// separate from the wikilinks parsed out of `tasks.description` - see
// extractOutgoingExhibitRefs/syncTaskExhibit in tasks.ts, which unions both
// into the set actually pushed to Capitol. Same shape as
// chamber-notes/src/db/schema.ts's noteRefs.
export const taskRefs = sqliteTable(
  "task_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("task_refs_task_target_idx").on(table.taskId, table.targetExhibitId)]
);

// Single-row table (id is always 1) - kept for contract uniformity with
// every other Chamber, even though Tasks has no settings of its own yet.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});
