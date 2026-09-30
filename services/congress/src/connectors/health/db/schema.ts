import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// The Health connector's store: Apple Health samples pushed in by Health Auto
// Export (a time series, never records), and its ingest token.

export const healthMetrics = sqliteTable(
  "health_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    metricType: text("metric_type").notNull(),
    value: real("value").notNull(),
    unit: text("unit").notNull(),
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }).notNull(),
    sourceName: text("source_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  // Resends overlap; a sample is its type and interval.
  (t) => [uniqueIndex("health_metrics_type_range_idx").on(t.metricType, t.startDate, t.endDate)]
);

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // Sent by the owner's Shortcut as X-Health-Ingest-Token.
  ingestToken: text("ingest_token"),
  lastIngestAt: integer("last_ingest_at", { mode: "timestamp_ms" }),
  // Off while the Fitness Chamber still receives the export.
  publishEvents: integer("publish_events", { mode: "boolean" }).notNull().default(false),
});
