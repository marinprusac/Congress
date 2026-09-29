import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// The type engine's own tables in exhibits.sqlite3. Type tables (x_*, j_*)
// live in the same file but are created at runtime, never by drizzle.

export const types = sqliteTable("types", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  tableName: text("table_name").notNull().unique(),
  currentVersion: integer("current_version").notNull(),
  // Current definition; type_versions keeps every earlier one.
  definitionJson: text("definition_json").notNull(),
  origin: text("origin", { enum: ["premade", "custom"] }).notNull(),
  premadeKey: text("premade_key"),
  premadeBatch: integer("premade_batch").notNull().default(0),
  forked: integer("forked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const typeVersions = sqliteTable(
  "type_versions",
  {
    typeId: text("type_id").notNull(),
    version: integer("version").notNull(),
    definitionJson: text("definition_json").notNull(),
    opsJson: text("ops_json").notNull(),
    planJson: text("plan_json").notNull(),
    actor: text("actor").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.typeId, t.version] })]
);

// Global record id -> type, so resolving an id never scans every table.
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("records_type_idx").on(t.typeId)]
);

// Manual Connections added from a record's Connections panel.
export const recordRefs = sqliteTable(
  "record_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recordId: text("record_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("record_refs_pair_idx").on(t.recordId, t.targetExhibitId)]
);

// Old Chamber exhibit ids (notes/note-42) mapped to the records that replaced them.
export const legacyAliases = sqliteTable(
  "legacy_aliases",
  {
    legacyChamber: text("legacy_chamber").notNull(),
    legacyId: text("legacy_id").notNull(),
    recordId: text("record_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.legacyChamber, t.legacyId] }), index("legacy_aliases_record_idx").on(t.recordId)]
);

export const imports = sqliteTable("imports", {
  key: text("key").primaryKey(),
  ranAt: integer("ran_at", { mode: "timestamp_ms" }).notNull(),
  statsJson: text("stats_json").notNull(),
});
