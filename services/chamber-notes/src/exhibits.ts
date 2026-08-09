import { like, or, inArray, desc } from "drizzle-orm";
import type {
  ExhibitSearchResult,
  ExhibitResolveResult,
  ExhibitSyncRequest,
  SharedExhibitContent,
  UpdateSharedExhibitContentRequest,
} from "@congress/shared-types";
import { db } from "./db/client.js";
import { notes } from "./db/schema.js";
import { env } from "./env.js";
import { getNote, updateNote } from "./notes.js";

const NOTE_ID_PREFIX = "note-";

export function toExhibitId(noteId: number): string {
  return `${NOTE_ID_PREFIX}${noteId}`;
}

export function parseNoteId(exhibitId: string): number | null {
  if (!exhibitId.startsWith(NOTE_ID_PREFIX)) return null;
  const id = Number(exhibitId.slice(NOTE_ID_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

// An empty query matches everything ("%%"), which combined with the
// most-recent-first ordering is exactly the "show me what's there" listing
// the picker wants before the user has typed anything.
export async function searchNoteExhibits(query: string, limit = 10): Promise<ExhibitSearchResult[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(notes)
    .where(or(like(notes.title, pattern), like(notes.body, pattern)))
    .orderBy(desc(notes.updatedAt))
    .limit(limit)
    .all();
  return rows.map((row) => ({
    id: toExhibitId(row.id),
    type: "note",
    name: row.title,
    url: `/n/${row.id}`,
  }));
}

export async function resolveNoteExhibits(ids: string[]): Promise<ExhibitResolveResult[]> {
  const idToNoteId = new Map<string, number>();
  for (const id of ids) {
    const noteId = parseNoteId(id);
    if (noteId !== null) idToNoteId.set(id, noteId);
  }

  const noteIds = [...idToNoteId.values()];
  const rows = noteIds.length > 0 ? db.select().from(notes).where(inArray(notes.id, noteIds)).all() : [];
  const byNoteId = new Map(rows.map((row) => [row.id, row]));

  return ids.map((id): ExhibitResolveResult => {
    const noteId = idToNoteId.get(id);
    const row = noteId !== undefined ? byNoteId.get(noteId) : undefined;
    if (!row) return { id, deleted: true };
    return { id, name: row.title, url: `/n/${row.id}` };
  });
}

// The generic content contract behind Exhibit Sharing - a share recipient
// only ever knows an exhibit id, never that it's specifically a "note", so
// this maps the note-specific detail shape into the canonical envelope.
export async function getNoteExhibitContent(id: string): Promise<SharedExhibitContent | null> {
  const noteId = parseNoteId(id);
  if (noteId === null) return null;
  const note = await getNote(noteId);
  if (!note) return null;
  return { id, chamber: "notes", type: "note", name: note.title, body: note.content, isBinary: false };
}

export async function updateNoteExhibitContent(
  id: string,
  input: UpdateSharedExhibitContentRequest
): Promise<SharedExhibitContent | null> {
  const noteId = parseNoteId(id);
  if (noteId === null) return null;
  const updated = await updateNote(noteId, { title: input.title, content: input.body });
  if (!updated) return null;
  return { id, chamber: "notes", type: "note", name: updated.title, body: updated.content, isBinary: false };
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Congress-Internal-Token": env.CONGRESS_INTERNAL_TOKEN,
  };
}

export async function pushExhibitSync(push: Omit<ExhibitSyncRequest, "chamber">): Promise<void> {
  try {
    const res = await fetch(`${env.CAPITOL_URL}/capitol/exhibits/sync`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ chamber: "notes", ...push }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`Exhibit sync rejected by Capitol: ${res.status}`);
    }
  } catch (err) {
    console.warn(`Exhibit sync failed: ${(err as Error).message}`);
  }
}
