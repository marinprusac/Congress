import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const places = sqliteTable(
  "places",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    body: text("body").notNull().default(""),
    // User-defined ("home", "work", "gym", ...). "ignored" is not a distinct
    // mechanism - it's just a place with this category, so a spot the owner
    // never wants prompted about again is saved once and future visits there
    // become ordinary confirmed visits, filtered out by category wherever it
    // matters (widgets, MCP tools) - see visits.ts's classifyVisit.
    category: text("category").notNull().default("place"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    radiusMeters: integer("radius_meters").notNull().default(100),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  // The list endpoint sorts by this on every request.
  (table) => [index("places_updated_at_idx").on(table.updatedAt)]
);

// Explicit references added from a place's "References" side panel, kept
// separate from the wikilinks parsed out of `places.body` - see
// extractOutgoingExhibitRefs/syncPlaceExhibit in places.ts, which unions both
// into the set actually pushed to Capitol. Same shape as every other
// Chamber's own "<entity>Refs" table (see e.g. chamber-notes/src/db/schema.ts's
// noteRefs).
export const placeRefs = sqliteTable(
  "place_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    placeId: integer("place_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("place_refs_place_target_idx").on(table.placeId, table.targetExhibitId)]
);

// One row per continuous dwell - the durable record this whole Chamber
// exists to produce ("Gym, 6:15-7:30am"), not a GPS breadcrumb trail. A null
// placeId + non-null clusterLatitude/clusterLongitude means the tracking
// loop hasn't matched this dwell to a known place yet (status "pending"
// until classified, or "adhoc" once given a one-off label without becoming
// a reusable place). departedAt null means the visit is still ongoing - see
// tracking.ts.
export const visits = sqliteTable(
  "visits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    placeId: integer("place_id").references(() => places.id, { onDelete: "set null" }),
    status: text("status", { enum: ["confirmed", "pending", "adhoc", "ignored"] }).notNull(),
    adhocLabel: text("adhoc_label"),
    clusterLatitude: real("cluster_latitude"),
    clusterLongitude: real("cluster_longitude"),
    arrivedAt: integer("arrived_at", { mode: "timestamp_ms" }).notNull(),
    departedAt: integer("departed_at", { mode: "timestamp_ms" }),
    // Dedup guard: an unclassified dwell only ever publishes
    // map.unclassified_dwell_pending once, the moment it crosses minDwellMs -
    // see tracking.ts.
    pendingNotifiedAt: integer("pending_notified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("visits_arrived_at_idx").on(table.arrivedAt), index("visits_status_idx").on(table.status)]
);

// A trip summary bridging two visits - computed once, from a transient
// in-memory buffer of raw fixes collected while in transit between them
// (tracking.ts), then the buffer is discarded. distanceKm/mode are rough by
// design (summed haversine between buffered points; mode guessed from
// speed), not turn-by-turn precision.
export const trips = sqliteTable(
  "trips",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromVisitId: integer("from_visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    toVisitId: integer("to_visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    departedAt: integer("departed_at", { mode: "timestamp_ms" }).notNull(),
    arrivedAt: integer("arrived_at", { mode: "timestamp_ms" }).notNull(),
    distanceKm: real("distance_km").notNull(),
    mode: text("mode", { enum: ["walk", "bike", "drive", "unknown"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  // listTrips() sorts by this on every request.
  (table) => [index("trips_departed_at_idx").on(table.departedAt)]
);

// Single-row table (id is always 1). unknownClusterRadiusMeters/minDwellMs
// are the user-facing tunables exposed through createSingleRowSettings (see
// settings.ts). lastProcessedAt/lastPollSucceededAt/lastPollError are
// internal poll-loop bookkeeping written directly by pollState.ts, not routed
// through the public Settings type/PUT /api/settings - kept on the same row
// purely to avoid a second single-row table, not because they're user
// settings. lastProcessedAt doubles as the durable cursor into Traccar's
// position stream, so a restart resumes instead of reprocessing or gapping -
// an improvement on chamber-tasks' fully in-memory (restart-losing)
// equivalent, cheap here since visits are already the durable record.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  unknownClusterRadiusMeters: integer("unknown_cluster_radius_meters").notNull().default(150),
  minDwellMs: integer("min_dwell_ms").notNull().default(45 * 60 * 1000),
  lastProcessedAt: integer("last_processed_at", { mode: "timestamp_ms" }),
  lastPollSucceededAt: integer("last_poll_succeeded_at", { mode: "timestamp_ms" }),
  lastPollError: text("last_poll_error"),
});
