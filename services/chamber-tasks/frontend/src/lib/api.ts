import type {
  TaskSummary,
  TaskDetail,
  CreateTaskRequest,
  UpdateTaskRequest,
  CapitolExhibitSearchResult,
} from "@congress/shared-types";

// In production this Chamber's frontend is proxied through Capitol at
// "/tasks/*", but its API calls still need to reach Capitol's gateway at
// "/api/tasks/*" (Capitol forwards "/api/tasks/<rest>" to this Chamber's own
// "/api/<rest>"). In dev, Vite proxies "/api" straight to this Chamber's own
// server, so no "/tasks" segment is needed there.
const API_BASE = import.meta.env.PROD ? "/api/tasks" : "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

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
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete task: ${res.status}`);
  }
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
