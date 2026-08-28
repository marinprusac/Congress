import matter from "gray-matter";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import type { NoteSummary, NoteDetail, CreateNoteRequest, UpdateNoteRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { notes } from "./db/schema.js";
import { makeExcerpt } from "./wikilinks.js";
import { toExhibitId, parseNoteId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForNote } from "./refs.js";
import { publishEvent } from "./events.js";

// The set of Exhibits this note connects to is the union of what's embedded
// in its body ("[[" tokens) and what was added explicitly via the
// Connections side panel (packages/congress-ui's ExhibitLinksLayout) - pushed
// to Capitol as one outgoingRefs list either way, so the undirected
// Connections graph doesn't need to know which source produced a given ref.
async function syncNoteExhibit(id: number, title: string, body: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(body), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "note",
    name: title,
    url: `/n/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a note whose body didn't change but whose manual refs did (see
// the /api/exhibits/:id/refs routes in server.ts).
export async function resyncNoteExhibit(id: number): Promise<void> {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) return;
  await syncNoteExhibit(id, row.title, row.body);
}

// Thin exhibit-id-keyed wrappers around the numeric-id refs.ts functions -
// this is what mountManualRefsRoutes (@congress/chamber-kit) actually calls,
// since it's mounted generically at "/api/exhibits/:id/refs" and only ever
// sees full Exhibit ids ("note-3"), not this Chamber's own row ids. A ref
// add/remove can also originate from a *different* Exhibit's "Referenced by"
// panel (via Capitol's proxy at POST/DELETE "/congress/exhibits/:id/refs"),
// so these have to resync exactly like the body-text path does.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parseNoteId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

export async function resyncNoteExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseNoteId(exhibitId);
  if (id !== null) await resyncNoteExhibit(id);
}

export class TitleConflictError extends Error {
  constructor(title: string) {
    super(`A note titled "${title}" already exists`);
    this.name = "TitleConflictError";
  }
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const { data, content: body } = matter(content);
  return { frontmatter: data ?? {}, body: body.replace(/^\s+/, "") };
}

function reconstructContent(frontmatter: Record<string, unknown>, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
  return matter.stringify(body, frontmatter);
}

async function titleExists(title: string, excludeId?: number): Promise<boolean> {
  const row = db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        sql`lower(${notes.title}) = lower(${title})`,
        excludeId !== undefined ? ne(notes.id, excludeId) : undefined
      )
    )
    .get();
  return Boolean(row);
}

function toSummary(row: typeof notes.$inferSelect): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    frontmatter: JSON.parse(row.frontmatterJson),
    excerpt: makeExcerpt(row.body),
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// makeExcerpt caps at 180 chars after stripping wikilinks/markdown syntax
// (which only ever shortens the text), so 400 raw chars is comfortable
// headroom. Selecting this instead of the full `body` column means a note's
// entire content - which can be many KB, and which list views never render -
// no longer has to be read out of SQLite, deserialized by Drizzle and
// JSON-serialized into the response just to build a one-line preview.
const summaryColumns = {
  id: notes.id,
  title: notes.title,
  frontmatterJson: notes.frontmatterJson,
  pinned: notes.pinned,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  bodyPrefix: sql<string>`substr(${notes.body}, 1, 400)`,
};

function toSummaryFromExcerptRow(row: {
  id: number;
  title: string;
  frontmatterJson: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  bodyPrefix: string;
}): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    frontmatter: JSON.parse(row.frontmatterJson),
    excerpt: makeExcerpt(row.bodyPrefix),
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listNotes(): Promise<NoteSummary[]> {
  const rows = db.select(summaryColumns).from(notes).orderBy(desc(notes.updatedAt)).all();
  return rows.map(toSummaryFromExcerptRow);
}

export async function listPinnedNotes(): Promise<NoteSummary[]> {
  const rows = db
    .select(summaryColumns)
    .from(notes)
    .where(eq(notes.pinned, true))
    .orderBy(desc(notes.updatedAt))
    .all();
  return rows.map(toSummaryFromExcerptRow);
}

export async function searchNotes(query: string): Promise<NoteSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select(summaryColumns)
    .from(notes)
    .where(or(like(notes.title, pattern), like(notes.body, pattern)))
    .orderBy(desc(notes.updatedAt))
    .all();
  return rows.map(toSummaryFromExcerptRow);
}

export async function getNote(id: number): Promise<NoteDetail | null> {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) return null;
  const frontmatter = JSON.parse(row.frontmatterJson);
  return {
    ...toSummary(row),
    content: reconstructContent(frontmatter, row.body),
  };
}

export async function createNote(input: CreateNoteRequest): Promise<NoteDetail> {
  if (await titleExists(input.title)) {
    throw new TitleConflictError(input.title);
  }
  const { frontmatter, body } = parseFrontmatter(input.content);
  const now = new Date();
  const inserted = db
    .insert(notes)
    .values({
      title: input.title,
      frontmatterJson: JSON.stringify(frontmatter),
      body,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncNoteExhibit(inserted.id, inserted.title, body);
  void publishEvent({
    type: "notes.created",
    payload: { noteId: inserted.id, title: inserted.title, url: `/n/${inserted.id}`, priority: "low" },
  });

  const created = await getNote(inserted.id);
  if (!created) throw new Error("Failed to read back created note");
  return created;
}

export async function updateNote(id: number, input: UpdateNoteRequest): Promise<NoteDetail | null> {
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return null;

  if (input.title && input.title !== existing.title && (await titleExists(input.title, id))) {
    throw new TitleConflictError(input.title);
  }

  let frontmatterJson = existing.frontmatterJson;
  let body = existing.body;
  if (input.content !== undefined) {
    const parsed = parseFrontmatter(input.content);
    frontmatterJson = JSON.stringify(parsed.frontmatter);
    body = parsed.body;
  }

  db.update(notes)
    .set({
      title: input.title ?? existing.title,
      frontmatterJson,
      body,
      pinned: input.pinned ?? existing.pinned,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))
    .run();

  const finalTitle = input.title ?? existing.title;
  await syncNoteExhibit(id, finalTitle, body);
  void publishEvent({
    type: "notes.updated",
    payload: { noteId: id, title: finalTitle, url: `/n/${id}`, priority: "low" },
  });

  return getNote(id);
}

export async function deleteNote(id: number): Promise<boolean> {
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  if (result.changes > 0 && existing) {
    deleteManualRefsForNote(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "note",
      name: existing.title,
      url: `/n/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
    void publishEvent({ type: "notes.deleted", payload: { noteId: id, title: existing.title, priority: "low" } });
  }
  return result.changes > 0;
}
