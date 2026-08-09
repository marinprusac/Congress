import matter from "gray-matter";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import type { NoteSummary, NoteDetail, CreateNoteRequest, UpdateNoteRequest } from "@congress/shared-types";
import { parseExhibitToken } from "@congress/shared-types";
import { db } from "./db/client.js";
import { notes } from "./db/schema.js";
import { extractWikiLinks, makeExcerpt } from "./wikilinks.js";
import { toExhibitId, pushExhibitSync } from "./exhibits.js";

// Outgoing refs are bare Exhibit ids (e.g. "note-3"), matching the id space
// used by exhibit_cache/exhibit_refs - not the "exhibit:chamber:id" token
// syntax, which only exists for embedding a reference in markdown text.
function extractOutgoingExhibitRefs(body: string): string[] {
  const ids = new Set<string>();
  for (const link of extractWikiLinks(body)) {
    const parsed = parseExhibitToken(link.target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
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

export async function listNotes(): Promise<NoteSummary[]> {
  const rows = db.select().from(notes).orderBy(desc(notes.updatedAt)).all();
  return rows.map(toSummary);
}

export async function listPinnedNotes(): Promise<NoteSummary[]> {
  const rows = db
    .select()
    .from(notes)
    .where(eq(notes.pinned, true))
    .orderBy(desc(notes.updatedAt))
    .all();
  return rows.map(toSummary);
}

export async function searchNotes(query: string): Promise<NoteSummary[]> {
  const pattern = `%${query}%`;
  const rows = db
    .select()
    .from(notes)
    .where(or(like(notes.title, pattern), like(notes.body, pattern)))
    .orderBy(desc(notes.updatedAt))
    .all();
  return rows.map(toSummary);
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

  await pushExhibitSync({
    id: toExhibitId(inserted.id),
    type: "note",
    name: inserted.title,
    url: `/n/${inserted.id}`,
    outgoingRefs: extractOutgoingExhibitRefs(body),
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
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "note",
    name: finalTitle,
    url: `/n/${id}`,
    outgoingRefs: extractOutgoingExhibitRefs(body),
  });

  return getNote(id);
}

export async function deleteNote(id: number): Promise<boolean> {
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  if (result.changes > 0 && existing) {
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "note",
      name: existing.title,
      url: `/n/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
  }
  return result.changes > 0;
}
