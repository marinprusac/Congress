import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import type { DocumentSummary, DocumentDetail, UpdateDocumentRequest } from "@congress/shared-types";
import { parseExhibitToken } from "@congress/shared-types";
import { db } from "./db/client.js";
import { documents } from "./db/schema.js";
import { env } from "./env.js";
import { toExhibitId, parseDocumentId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForDocument } from "./refs.js";

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // "modest documents," not a config knob

export class FileTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(`File is ${sizeBytes} bytes, exceeding the ${MAX_FILE_SIZE_BYTES}-byte limit`);
    this.name = "FileTooLargeError";
  }
}

// Same regex+parseExhibitToken-filter shape as chamber-notes/src/notes.ts
// and chamber-calendar/src/exhibits.ts's extractOutgoingExhibitRefs - kept
// as its own small per-chamber copy rather than shared, per established
// precedent.
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
function extractOutgoingExhibitRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const parsed = parseExhibitToken(target);
    if (parsed) ids.add(parsed.id);
  }
  return [...ids];
}

// The set of Exhibits this document points at is the union of what's
// embedded in its description ("[[" tokens) and what was added explicitly
// via the References side panel - pushed to Capitol as one outgoingRefs
// list either way. Same shape as chamber-notes/src/notes.ts's
// syncNoteExhibit.
async function syncDocumentExhibit(id: number, title: string, description: string): Promise<void> {
  const manual = listManualRefs(id);
  const outgoingRefs = new Set([...extractOutgoingExhibitRefs(description), ...manual]);
  await pushExhibitSync({
    id: toExhibitId(id),
    type: "document",
    name: title,
    url: `/d/${id}`,
    outgoingRefs: [...outgoingRefs],
    manualRefs: manual,
  });
}

// Re-syncs a document whose description didn't change but whose manual
// refs did (see the /api/exhibits/:id/refs routes in server.ts).
export async function resyncDocumentExhibit(id: number): Promise<void> {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return;
  await syncDocumentExhibit(id, row.title, row.description);
}

// Thin exhibit-id-keyed wrappers for mountManualRefsRoutes
// (@congress/chamber-kit), which only ever sees full Exhibit ids
// ("document-3"), not this Chamber's own row ids - same shape as
// chamber-notes/src/notes.ts's listManualRefsByExhibitId and friends.
export function listManualRefsByExhibitId(exhibitId: string): string[] | null {
  const id = parseDocumentId(exhibitId);
  return id === null ? null : listManualRefs(id);
}

export function addManualRefByExhibitId(exhibitId: string, targetExhibitId: string): boolean {
  const id = parseDocumentId(exhibitId);
  if (id === null) return false;
  addManualRef(id, targetExhibitId);
  return true;
}

export function removeManualRefByExhibitId(exhibitId: string, targetExhibitId: string): boolean {
  const id = parseDocumentId(exhibitId);
  if (id === null) return false;
  removeManualRef(id, targetExhibitId);
  return true;
}

export async function resyncDocumentExhibitByExhibitId(exhibitId: string): Promise<void> {
  const id = parseDocumentId(exhibitId);
  if (id !== null) await resyncDocumentExhibit(id);
}

function toSummary(row: typeof documents.$inferSelect): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: typeof documents.$inferSelect): DocumentDetail {
  return { ...toSummary(row), description: row.description };
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = db.select().from(documents).orderBy(desc(documents.updatedAt)).all();
  return rows.map(toSummary);
}

export async function getDocument(id: number): Promise<DocumentDetail | null> {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  return row ? toDetail(row) : null;
}

export interface CreateDocumentInput {
  title: string;
  description: string;
  file: { filename: string; mimeType: string; bytes: Uint8Array };
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDetail> {
  if (input.file.bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(input.file.bytes.byteLength);
  }

  const storageKey = randomUUID();
  await writeFile(join(env.FILES_DIR, storageKey), input.file.bytes);

  const now = new Date();
  const inserted = db
    .insert(documents)
    .values({
      title: input.title,
      filename: input.file.filename,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.bytes.byteLength,
      storageKey,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncDocumentExhibit(inserted.id, inserted.title, inserted.description);

  return toDetail(inserted);
}

export async function updateDocument(id: number, input: UpdateDocumentRequest): Promise<DocumentDetail | null> {
  const existing = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!existing) return null;

  const title = input.title ?? existing.title;
  const description = input.description ?? existing.description;

  db.update(documents)
    .set({ title, description, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .run();

  await syncDocumentExhibit(id, title, description);

  return getDocument(id);
}

export async function deleteDocument(id: number): Promise<boolean> {
  const existing = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!existing) return false;

  const result = db.delete(documents).where(eq(documents.id, id)).run();
  if (result.changes > 0) {
    await unlink(join(env.FILES_DIR, existing.storageKey)).catch((err) => {
      console.warn(`Failed to remove stored file for document ${id}: ${(err as Error).message}`);
    });
    deleteManualRefsForDocument(id);
    await pushExhibitSync({
      id: toExhibitId(id),
      type: "document",
      name: existing.title,
      url: `/d/${id}`,
      outgoingRefs: [],
      deleted: true,
    });
  }
  return result.changes > 0;
}

export interface DocumentFile {
  filename: string;
  mimeType: string;
  path: string;
}

export async function getDocumentFile(id: number): Promise<DocumentFile | null> {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return null;
  return { filename: row.filename, mimeType: row.mimeType, path: join(env.FILES_DIR, row.storageKey) };
}
