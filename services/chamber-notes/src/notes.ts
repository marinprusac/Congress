import matter from "gray-matter";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import type {
  NoteSummary,
  NoteDetail,
  CreateNoteRequest,
  UpdateNoteRequest,
  WikiLink,
  Backlink,
} from "@congress/shared-types";
import { db } from "./db/client.js";
import { notes, links } from "./db/schema.js";
import { extractWikiLinks, makeExcerpt } from "./wikilinks.js";

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

function syncLinks(noteId: number, body: string) {
  db.delete(links).where(eq(links.sourceNoteId, noteId)).run();
  const parsed = extractWikiLinks(body);
  const uniqueTargets = new Map<string, string>();
  for (const link of parsed) {
    uniqueTargets.set(link.target.toLowerCase(), link.target);
  }
  for (const target of uniqueTargets.values()) {
    db.insert(links).values({ sourceNoteId: noteId, targetTitle: target }).run();
  }
}

function toSummary(row: typeof notes.$inferSelect): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    frontmatter: JSON.parse(row.frontmatterJson),
    excerpt: makeExcerpt(row.body),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function resolveOutgoingLinks(noteId: number): Promise<WikiLink[]> {
  const rows = db.select().from(links).where(eq(links.sourceNoteId, noteId)).all();
  const result: WikiLink[] = [];
  for (const row of rows) {
    const exists = await titleExists(row.targetTitle);
    result.push({ target: row.targetTitle, alias: null, resolved: exists });
  }
  return result;
}

function getBacklinks(title: string): Backlink[] {
  const rows = db
    .select({ id: notes.id, title: notes.title })
    .from(links)
    .innerJoin(notes, eq(links.sourceNoteId, notes.id))
    .where(sql`lower(${links.targetTitle}) = lower(${title})`)
    .all();
  return rows;
}

export async function listNotes(): Promise<NoteSummary[]> {
  const rows = db.select().from(notes).orderBy(desc(notes.updatedAt)).all();
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
  const [outgoingLinks, backlinks] = await Promise.all([
    resolveOutgoingLinks(row.id),
    Promise.resolve(getBacklinks(row.title)),
  ]);
  return {
    ...toSummary(row),
    content: reconstructContent(frontmatter, row.body),
    outgoingLinks,
    backlinks,
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

  syncLinks(inserted.id, body);

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
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))
    .run();

  if (input.content !== undefined) {
    syncLinks(id, body);
  }

  return getNote(id);
}

export async function deleteNote(id: number): Promise<boolean> {
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  return result.changes > 0;
}
