import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    dueDate: integer("due_date", { mode: "timestamp_ms" }),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    // The list endpoint sorts by this on every request.
    index("tasks_updated_at_idx").on(table.updatedAt),
    // listOpenTasks() and the due-date timer (notifications.ts) both filter
    // on this exact pair on every task mutation.
    index("tasks_completed_due_date_idx").on(table.completed, table.dueDate),
  ]
);

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

// Single-row table (id is always 1), same contract as every other Chamber.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});

// Persisted counterpart of the old in-memory "what did I last publish for
// this task" map in notifications.ts - a plain JS Map reset to empty on
// every restart, so a deploy made every still-due task look "new" again and
// re-fire its event. No FK to `tasks`: a row surviving its task's deletion
// is what lets checkDueTasks() still notice the task is gone and publish
// tasks.due_cleared for it.
export const dueNotifications = sqliteTable("due_notifications", {
  taskId: integer("task_id").primaryKey(),
  state: text("state").notNull(),
});
