import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
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
});
