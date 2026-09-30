import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { recordRefs, recordTriggerState } from "../db/schema.js";
import { getTypeByPremadeKey } from "../store.js";
import { createRecord, syncRecordExhibit } from "../records.js";
import { addLegacyAlias } from "../aliases.js";
import { ulid } from "../ulid.js";
import { dayOf } from "../zone.js";
import { alreadyImported, canonicalTarget, chamberPath, markImported, rewriteCoreDb, type CoreRewriteStats, type LegacySpec } from "./common.js";

// One-time import of the Tasks Chamber into the Task type, read-only.
// Delete once it has run in production.

export const TASKS_SPEC: LegacySpec = {
  key: "tasks-v1",
  chamber: "tasks",
  idPrefix: "task-",
  eventPrefix: "task",
  payloadRenames: { taskId: "recordId", name: "title" },
};
const TASKS_DIR = fileURLToPath(new URL("../../../../chamber-tasks", import.meta.url));

export function defaultTasksDbPath(): string {
  return chamberPath(TASKS_DIR, "DB_PATH", "./data/tasks.sqlite3");
}

export interface TasksImportStats extends Partial<CoreRewriteStats> {
  skipped?: "already_ran" | "no_source" | "no_type";
  tasks: number;
  refs: number;
  triggerStates: number;
}

export interface TaskRow {
  id: number;
  name: string;
  description: string;
  due_date: number | null;
  completed: number;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

// The Task record's values for a Chamber row. A due date named a day as an
// instant (local or UTC midnight); both land on the same day in the owner's zone.
export function taskValues(row: TaskRow) {
  return {
    title: row.name.trim() || "Untitled task",
    description: row.description,
    due: row.due_date === null ? null : dayOf(row.due_date),
    completed: row.completed === 1,
    completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
  };
}

export function importLegacyTasks(from: string = defaultTasksDbPath()): TasksImportStats {
  const stats: TasksImportStats = { tasks: 0, refs: 0, triggerStates: 0 };
  if (alreadyImported(TASKS_SPEC.key)) return { ...stats, skipped: "already_ran" };
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const type = getTypeByPremadeKey("task");
  if (!type) return { ...stats, skipped: "no_type" };
  const dueField = type.definition.fields.find((f) => f.slug === "due")!;

  const source = new Database(from, { readonly: true, fileMustExist: true });
  const rows = source.prepare("SELECT id, name, description, due_date, completed, completed_at, created_at, updated_at FROM tasks ORDER BY id").all() as TaskRow[];
  const refs = source.prepare("SELECT task_id, target_exhibit_id FROM task_refs ORDER BY id").all() as { task_id: number; target_exhibit_id: string }[];
  const states = source.prepare("SELECT task_id, state FROM due_notifications").all() as { task_id: number; state: string }[];
  source.close();

  const idFor = new Map<number, string>();
  for (const row of rows) idFor.set(row.id, ulid(row.created_at));

  exhibitsSqlite.transaction(() => {
    for (const row of rows) {
      const id = idFor.get(row.id)!;
      createRecord("task", taskValues(row), { id, at: new Date(row.created_at), updatedAt: new Date(row.updated_at), silent: true, trusted: true });
      addLegacyAlias(TASKS_SPEC.chamber, `${TASKS_SPEC.idPrefix}${row.id}`, id);
      stats.tasks++;
    }
    for (const ref of refs) {
      const recordId = idFor.get(ref.task_id);
      if (!recordId) continue;
      exhibitsDb
        .insert(recordRefs)
        .values({ recordId, targetExhibitId: canonicalTarget(ref.target_exhibit_id, TASKS_SPEC, idFor), createdAt: new Date() })
        .onConflictDoNothing()
        .run();
      stats.refs++;
    }
    // What the Chamber already announced, so the ladder doesn't announce it again.
    for (const s of states) {
      const recordId = idFor.get(s.task_id);
      if (!recordId) continue;
      exhibitsDb
        .insert(recordTriggerState)
        .values({ recordId, typeId: type.id, ladder: dueField.id, state: s.state, firedAt: new Date() })
        .onConflictDoNothing()
        .run();
      stats.triggerStates++;
    }
    markImported(TASKS_SPEC.key, {});
  })();

  Object.assign(stats, rewriteCoreDb(TASKS_SPEC, idFor));
  for (const id of idFor.values()) syncRecordExhibit(type, id);
  markImported(TASKS_SPEC.key, stats);
  return stats;
}
