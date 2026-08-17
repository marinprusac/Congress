import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Single-row table (id is always 1) - Capitol's own local preferences, kept
// separate from Congress's Congress-wide settings (e.g. dark mode) since
// this only matters while Capitol itself is registered and rendering the
// homepage widget grid.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // Chamber names hidden from the homepage widget grid, JSON-encoded.
  hiddenWidgetsJson: text("hidden_widgets_json").notNull().default("[]"),
});
