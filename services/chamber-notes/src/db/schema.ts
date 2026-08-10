import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().unique(),
  frontmatterJson: text("frontmatter_json").notNull().default("{}"),
  body: text("body").notNull().default(""),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Single-row table (id is always 1) - Notes has one chamber-wide settings scope, not per-user.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  autoSave: integer("auto_save", { mode: "boolean" }).notNull().default(false),
});
