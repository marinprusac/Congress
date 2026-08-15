import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().unique(),
  frontmatterJson: text("frontmatter_json").notNull().default("{}"),
  body: text("body").notNull().default(""),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Explicit references added from the note's "References" side panel, kept
// separate from the wikilinks parsed out of `notes.body` - see
// extractOutgoingExhibitRefs/syncNoteExhibit in notes.ts, which unions both
// into the set actually pushed to Capitol.
export const noteRefs = sqliteTable(
  "note_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    noteId: integer("note_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("note_refs_note_target_idx").on(table.noteId, table.targetExhibitId)]
);

// Single-row table (id is always 1) - Notes has one chamber-wide settings scope, not per-user.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  autoSave: integer("auto_save", { mode: "boolean" }).notNull().default(false),
});
