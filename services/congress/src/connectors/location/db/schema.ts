import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// The location connector's store: the GPS log (kept forever, so history can
// be rebuilt), the visits and trips derived from it with the owner's
// classifications, a mirror of the owner's Place records, and settings.

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
  (t) => [uniqueIndex("positions_traccar_id_idx").on(t.traccarPositionId), index("positions_fix_time_idx").on(t.fixTime)]
);

// Place records (type "place"), as tracking reads them; kept current by onRecordChange.
export const places = sqliteTable("places", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(100),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const visits = sqliteTable(
  "visits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // A Place record id; null once that place is gone.
    placeId: text("place_id"),
    status: text("status", { enum: ["confirmed", "pending", "adhoc", "ignored"] }).notNull(),
    adhocLabel: text("adhoc_label"),
    clusterLatitude: real("cluster_latitude"),
    clusterLongitude: real("cluster_longitude"),
    arrivedAt: integer("arrived_at", { mode: "timestamp_ms" }).notNull(),
    departedAt: integer("departed_at", { mode: "timestamp_ms" }),
    pendingNotifiedAt: integer("pending_notified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("visits_arrived_at_idx").on(t.arrivedAt), index("visits_status_idx").on(t.status)]
);

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
    mode: text("mode", { enum: ["walk", "bike", "transit", "unknown"] }).notNull(),
    // [[lat, lon], ...] of the fixes between the two visits.
    path: text("path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("trips_departed_at_idx").on(t.departedAt)]
);

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // A self-hosted Traccar server and the one device it follows.
  traccarUrl: text("traccar_url"),
  traccarToken: text("traccar_token"),
  traccarDeviceId: integer("traccar_device_id"),
  unknownClusterRadiusMeters: integer("unknown_cluster_radius_meters").notNull().default(150),
  minDwellMs: integer("min_dwell_ms").notNull().default(15 * 60 * 1000),
  stoppedSpeedKmh: real("stopped_speed_kmh").notNull().default(3),
  pollIntervalMs: integer("poll_interval_ms").notNull().default(2 * 60 * 1000),
  staleThresholdMs: integer("stale_threshold_ms").notNull().default(12 * 60 * 60 * 1000),
  lastProcessedAt: integer("last_processed_at", { mode: "timestamp_ms" }),
  lastPollSucceededAt: integer("last_poll_succeeded_at", { mode: "timestamp_ms" }),
  lastPollError: text("last_poll_error"),
});
