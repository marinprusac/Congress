import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable(
  "documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // randomUUID() - never the user-supplied filename - maps to
    // <FILES_DIR>/<storageKey> on disk. Keeps the on-disk path free of
    // traversal/collision concerns; filename is kept only for display and
    // the download response's Content-Disposition header.
    storageKey: text("storage_key").notNull().unique(),
    description: text("description").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  // The list endpoint sorts by this on every request - without an index,
  // that's a full table scan sort every time.
  (table) => [index("documents_updated_at_idx").on(table.updatedAt)]
);

// Explicit references added from the document's "References" side panel,
// kept separate from the wikilinks parsed out of `documents.description` -
// see extractOutgoingExhibitRefs/syncDocumentExhibit in documents.ts, which
// unions both into the set actually pushed to Capitol. Same shape as
// chamber-notes/src/db/schema.ts's noteRefs.
export const documentRefs = sqliteTable(
  "document_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("document_refs_document_target_idx").on(table.documentId, table.targetExhibitId)]
);
