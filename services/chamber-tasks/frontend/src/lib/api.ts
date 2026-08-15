import type { TaskSummary, TaskDetail, CreateTaskRequest, UpdateTaskRequest } from "../../../src/types";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("tasks", import.meta.env.PROD);

export function fetchTasks(): Promise<TaskSummary[]> {
  return fetch(`${API_BASE}/tasks`).then((res) => json(res));
}

export function fetchOpenTasks(): Promise<TaskSummary[]> {
  return fetch(`${API_BASE}/tasks/open`).then((res) => json(res));
}

export function searchTasks(query: string): Promise<TaskSummary[]> {
  return fetch(`${API_BASE}/tasks/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchTask(id: number): Promise<TaskDetail> {
  return fetch(`${API_BASE}/tasks/${id}`).then((res) => json(res));
}

export function createTask(input: CreateTaskRequest): Promise<TaskDetail> {
  return fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateTask(id: number, input: UpdateTaskRequest): Promise<TaskDetail> {
  return fetch(`${API_BASE}/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteTask(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete task");
}

// Quick-create a task from a "[[" picker or the References panel's "+
// Create" option, without leaving the field the user was in - mirrors
// Obsidian's "create note from link", scoped to Tasks the same way
// chamber-notes/frontend/src/lib/api.ts's quickCreateNoteExhibit is scoped
// to Notes: each Chamber can only quick-create its own Exhibit type.
export async function quickCreateTaskExhibit(title: string): Promise<CapitolExhibitSearchResult> {
  const task = await createTask({ name: title, description: "", dueDate: null });
  return { chamber: "tasks", id: `task-${task.id}`, type: "task", name: task.name, url: `/t/${task.id}` };
}

export function setCompleted(id: number, completed: boolean): Promise<TaskDetail> {
  return fetch(`${API_BASE}/tasks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  }).then((res) => json(res));
}
