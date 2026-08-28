import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc, eq } from "drizzle-orm";
import type { DocumentSummary, DocumentDetail, UpdateDocumentRequest } from "./types.js";
import { extractOutgoingExhibitRefs, createManualRefsByExhibitId } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { documents } from "./db/schema.js";
import { env } from "./env.js";
import { toExhibitId, parseDocumentId, pushExhibitSync } from "./exhibits.js";
import { listManualRefs, addManualRef, removeManualRef, deleteManualRefsForDocument } from "./refs.js";
import { publishEvent } from "./events.js";

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // "modest documents," not a config knob

export class FileTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(`File is ${sizeBytes} bytes, exceeding the ${MAX_FILE_SIZE_BYTES}-byte limit`);
    this.name = "FileTooLargeError";
  }
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
// ("document-3"), not this Chamber's own row ids.
const manualRefsByExhibitId = createManualRefsByExhibitId(
  { listManualRefs, addManualRef, removeManualRef },
  parseDocumentId
);
export const listManualRefsByExhibitId = manualRefsByExhibitId.listManualRefsByExhibitId;
export const addManualRefByExhibitId = manualRefsByExhibitId.addManualRefByExhibitId;
export const removeManualRefByExhibitId = manualRefsByExhibitId.removeManualRefByExhibitId;

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

// Explicit columns rather than `db.select()` - a list view never renders
// `description` (can be as long as a note body) or the internal
// `storageKey`, so there's no reason to read either out of SQLite and
// serialize it into the response just to build a title/size/date row.
export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      filename: documents.filename,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .orderBy(desc(documents.updatedAt))
    .all();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getDocument(id: number): Promise<DocumentDetail | null> {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  return row ? toDetail(row) : null;
}

export interface CreateDocumentInput {
  title: string;
  description: string;
  file: { filename: string; mimeType: string; sizeBytes: number; stream: () => ReadableStream<Uint8Array> };
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDetail> {
  if (input.file.sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(input.file.sizeBytes);
  }

  const storageKey = randomUUID();
  // Piped straight to disk rather than buffered into a Uint8Array first (the
  // caller already validated size against MAX_FILE_SIZE_BYTES from the
  // upload's own reported size, without needing to read a single byte) - a
  // large-but-still-"modest" document no longer has to exist wholly in this
  // process's memory before a byte of it is written.
  await pipeline(Readable.fromWeb(input.file.stream()), createWriteStream(join(env.FILES_DIR, storageKey)));

  const now = new Date();
  const inserted = db
    .insert(documents)
    .values({
      title: input.title,
      filename: input.file.filename,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.sizeBytes,
      storageKey,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await syncDocumentExhibit(inserted.id, inserted.title, inserted.description);
  void publishEvent({
    type: "documents.created",
    payload: { documentId: inserted.id, title: inserted.title, url: `/d/${inserted.id}`, priority: "low" },
  });

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
  void publishEvent({
    type: "documents.updated",
    payload: { documentId: id, title, url: `/d/${id}`, priority: "low" },
  });

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
    void publishEvent({
      type: "documents.deleted",
      payload: { documentId: id, title: existing.title, priority: "low" },
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
