import type {
  NoteSummary,
  NoteDetail,
  CreateNoteRequest,
  UpdateNoteRequest,
  ChamberWidget,
} from "@congress/shared-types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchNotes(): Promise<NoteSummary[]> {
  return fetch("/api/notes").then((res) => json(res));
}

export function searchNotes(query: string): Promise<NoteSummary[]> {
  return fetch(`/api/notes/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchNote(id: number): Promise<NoteDetail> {
  return fetch(`/api/notes/${id}`).then((res) => json(res));
}

export function createNote(input: CreateNoteRequest): Promise<NoteDetail> {
  return fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateNote(id: number, input: UpdateNoteRequest): Promise<NoteDetail> {
  return fetch(`/api/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteNote(id: number): Promise<void> {
  const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete note: ${res.status}`);
  }
}

export function fetchWidget(): Promise<ChamberWidget> {
  return fetch("/api/widget").then((res) => json(res));
}
