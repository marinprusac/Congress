import type {
  NoteSummary,
  NoteDetail,
  CreateNoteRequest,
  UpdateNoteRequest,
  NotesSettings,
  UpdateNotesSettingsRequest,
  CapitolExhibitSearchResult,
  ManualRefsResponse,
} from "@congress/shared-types";

// In production this Chamber's frontend is proxied through Capitol at
// "/notes/*", but its API calls still need to reach Capitol's gateway at
// "/api/notes/*" (Capitol forwards "/api/notes/<rest>" to this Chamber's own
// "/api/<rest>"). In dev, Vite proxies "/api" straight to this Chamber's own
// server, so no "/notes" segment is needed there.
const API_BASE = import.meta.env.PROD ? "/api/notes" : "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchNotes(): Promise<NoteSummary[]> {
  return fetch(`${API_BASE}/notes`).then((res) => json(res));
}

export function searchNotes(query: string): Promise<NoteSummary[]> {
  return fetch(`${API_BASE}/notes/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchNote(id: number): Promise<NoteDetail> {
  return fetch(`${API_BASE}/notes/${id}`).then((res) => json(res));
}

export function createNote(input: CreateNoteRequest): Promise<NoteDetail> {
  return fetch(`${API_BASE}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateNote(id: number, input: UpdateNoteRequest): Promise<NoteDetail> {
  return fetch(`${API_BASE}/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteNote(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/notes/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete note: ${res.status}`);
  }
}

export function fetchPinnedNotes(): Promise<NoteSummary[]> {
  return fetch(`${API_BASE}/notes/pinned`).then((res) => json(res));
}

export function setPinned(id: number, pinned: boolean): Promise<NoteDetail> {
  return fetch(`${API_BASE}/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  }).then((res) => json(res));
}

export function addNoteRef(id: number, targetExhibitId: string): Promise<ManualRefsResponse> {
  return fetch(`${API_BASE}/notes/${id}/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetExhibitId }),
  }).then((res) => json(res));
}

export function removeNoteRef(id: number, targetExhibitId: string): Promise<ManualRefsResponse> {
  return fetch(`${API_BASE}/notes/${id}/refs/${encodeURIComponent(targetExhibitId)}`, {
    method: "DELETE",
  }).then((res) => json(res));
}

// Quick-create a note from a "[[" picker or the References panel's "+
// Create" option, without leaving the field the user was in - mirrors
// Obsidian's "create note from link". Kept in this Chamber's own API layer
// (not exhibit-ui) since only Notes can quick-create its own Exhibit type.
export async function quickCreateNoteExhibit(title: string): Promise<CapitolExhibitSearchResult> {
  const note = await createNote({ title, content: "" });
  return { chamber: "notes", id: `note-${note.id}`, type: "note", name: note.title, url: `/n/${note.id}` };
}

export function fetchSettings(): Promise<NotesSettings> {
  return fetch(`${API_BASE}/settings`).then((res) => json(res));
}

export function updateSettings(input: UpdateNotesSettingsRequest): Promise<NotesSettings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}
