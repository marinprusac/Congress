import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  body: text("body").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Explicit references added from an item's "References" side panel, kept
// separate from the wikilinks parsed out of `items.body` - see
// extractOutgoingExhibitRefs/syncItemExhibit in items.ts, which unions both
// into the set actually pushed to Capitol. Same shape as every other
// Chamber's own "<entity>Refs" table (see e.g.
// chamber-notes/src/db/schema.ts's noteRefs).
export const itemRefs = sqliteTable(
  "item_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("item_refs_item_target_idx").on(table.itemId, table.targetExhibitId)]
);

// Single-row table (id is always 1) - kept for contract uniformity with
// every other Chamber, even if this one has no settings of its own yet.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});
