import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().unique(),
  frontmatterJson: text("frontmatter_json").notNull().default("{}"),
  body: text("body").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const links = sqliteTable(
  "links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceNoteId: integer("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetTitle: text("target_title").notNull(),
  },
  (table) => [
    index("links_source_note_id_idx").on(table.sourceNoteId),
    index("links_target_title_idx").on(table.targetTitle),
  ]
);
