import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Where each registered widget sits on Capitol's cell-based canvas, one row
// per placed widget per viewport-class scope ("mobile" | "desktop" - see
// components/canvas/ for why exactly two, not one per physical device).
// (scope, chamber, widgetId) is the natural identity, so it's the primary
// key directly rather than a separate surrogate id + unique index - a
// placement is upserted by conflicting on this key. No width/height here:
// those live on the Chamber's own manifest-declared widget, so a Chamber
// changing its declared size later can't leave stale dimensions behind in
// this table. A widget with no row here for a given scope is simply unplaced
// (not shown) - "placed" is the only visibility mechanism now.
export const widgetLayouts = sqliteTable(
  "widget_layouts",
  {
    scope: text("scope", { enum: ["mobile", "desktop"] }).notNull(),
    chamber: text("chamber").notNull(),
    widgetId: text("widget_id").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.chamber, table.widgetId] })]
);
