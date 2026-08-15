import type {
  NoteSummary,
  NoteDetail,
  CreateNoteRequest,
  UpdateNoteRequest,
  NotesSettings,
  UpdateNotesSettingsRequest,
} from "../../../src/types";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/exhibit-ui";

const API_BASE = resolveApiBase("notes", import.meta.env.PROD);

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
  assertDeleteOk(res, "delete note");
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
