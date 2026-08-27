import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// The permanent, unabridged GPS log - every fix Traccar ever reports for the
// tracked device, kept forever regardless of whether it ends up attributed
// to a visit's dwell or a trip's path (tracking.ts's recordPosition inserts
// one row per fix, unconditionally, before any of that classification
// logic runs). Visits/trips below are derived summaries computed on top of
// this; this table is their source of truth, not the other way around -
// never pruned, and (deliberately, at the owner's request) not collapsed
// into a running reduction the way inTransitAcc's distance/mode guess is.
// traccarPositionId dedupes a fix that lands in two overlapping poll
// windows (poller.ts's `since` cursor) rather than logging it twice.
export const positions = sqliteTable(
  "positions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    traccarPositionId: integer("traccar_position_id").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    speedKnots: real("speed_knots").notNull(),
    fixTime: integer("fix_time", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("positions_traccar_id_idx").on(table.traccarPositionId),
    index("positions_fix_time_idx").on(table.fixTime),
  ]
);

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

// One row per continuous dwell - the human-readable record this whole
// Chamber exists to produce ("Gym, 6:15-7:30am"), a summary layered on top
// of the permanent breadcrumb trail in `positions` above, not a replacement
// for it. A null placeId + non-null clusterLatitude/clusterLongitude means
// the tracking
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
    // Always set the moment this row is inserted - a pending visit is only
    // ever persisted once its dwell has already crossed minDwellMs (see
    // tracking.ts's candidate-stop buffering), so promotion and the one-time
    // map.unclassified_dwell_pending publish happen together. Kept as its
    // own nullable column (rather than inferring "notified" from the row's
    // mere existence) so a future dwell-worth-reclassifying case has
    // somewhere to record it without overloading createdAt.
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
    mode: text("mode", { enum: ["walk", "bike", "drive", "flight", "unknown"] }).notNull(),
    // Owner-authored purpose ("walking the dog", "getting lunch"), only ever
    // meaningful for a trip whose endpoints are the same known place (see
    // visits.ts's needsLabel) - a same-place round trip with no dot recorded
    // in between is otherwise invisible: fromLabel/toLabel alone would just
    // say "Home -> Home". Left null for every other trip; no UI prompts for
    // one there.
    label: text("label"),
    // The actual GPS fixes seen in transit (JSON array of [lat, lon] pairs,
    // ascending by time) - what the frontend map draws as the trip's line.
    // A denormalized copy for fast rendering without a `positions` range
    // query on every trip list, not the source of truth - `positions` above
    // is permanent regardless of what happens here. Null only for a trip
    // whose in-memory accumulator was lost to a Chamber restart mid-trip
    // (see tracking.ts's inTransitAcc); the fixes themselves are still in
    // `positions`, just not denormalized onto this row.
    path: text("path"),
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
  // How long an unmatched, stopped fix has to keep recurring near the same
  // spot before it's worth anything - below this, it's a red light or a
  // drive-thru queue and silently folds into trip transit (no visit row at
  // all); at or above it, tracking.ts persists a pending visit (dot) and
  // fires map.unclassified_dwell_pending in the same step - one threshold
  // for both "is this a place" and "is this worth asking about", not two.
  minDwellMs: integer("min_dwell_ms").notNull().default(15 * 60 * 1000),
  // Below this, an unmatched fix is "stopped" (candidate dwell); at or above,
  // it's transit - see tracking.ts's own comment on why speed, not
  // distance-based clustering, is what tells the two apart.
  stoppedSpeedKmh: real("stopped_speed_kmh").notNull().default(3),
  // How often the poll loop asks Traccar for new fixes - poller.ts rereads
  // this every tick instead of only at boot, so a change here takes effect
  // on the very next tick without a restart.
  pollIntervalMs: integer("poll_interval_ms").notNull().default(2 * 60 * 1000),
  lastProcessedAt: integer("last_processed_at", { mode: "timestamp_ms" }),
  lastPollSucceededAt: integer("last_poll_succeeded_at", { mode: "timestamp_ms" }),
  lastPollError: text("last_poll_error"),
});
