import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// Hevy is the sole source of truth for workout content - this table is a
// local mirror kept in sync by src/hevy/poller.ts, never written to directly
// from this Chamber's own REST API (no create/update/delete routes exist for
// workouts, unlike the scaffold's generic "item" example).
export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hevyId: text("hevy_id").notNull().unique(),
  title: text("title").notNull(),
  startTime: integer("start_time", { mode: "timestamp_ms" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp_ms" }).notNull(),
  exerciseCount: integer("exercise_count").notNull().default(0),
  // Sum of weight_kg * reps across every set - null when a workout has no
  // weight-bearing sets at all (e.g. a pure cardio session), not 0, so a
  // "0 kg" session can't be told apart from "not applicable" downstream.
  totalVolumeKg: real("total_volume_kg"),
  // Raw structured exercises/sets as returned by Hevy - a JSON blob is
  // enough for v1 rendering and this Chamber's own search; no need for
  // child tables unless later analytics demand relational set queries.
  exercisesJson: text("exercises_json").notNull(),
  // Denormalized space-joined exercise names, purely so exhibit search can
  // match "bench press" without parsing exercisesJson on every query.
  exerciseNames: text("exercise_names").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Explicit references added from a workout's References side panel - same
// shape as every other Chamber's own "<entity>Refs" table (see e.g.
// chamber-notes/src/db/schema.ts's noteRefs). Workouts have no body text of
// their own to parse "[[" tokens out of, so unlike itemRefs this is the
// *only* source of a workout's outgoingRefs, not a union with parsed refs.
export const workoutRefs = sqliteTable(
  "workout_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutId: integer("workout_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("workout_refs_workout_target_idx").on(table.workoutId, table.targetExhibitId)]
);

// Single-row table (id is always 1). hevyApiKey is the one owner-facing
// field, routed through the public Settings type/PUT /api/settings.
// hevyLastSyncedAt/hevyConsecutiveFailures/hevyLastPollError are internal
// poll-loop bookkeeping written directly by hevy/pollState.ts, never through
// updateSettings - kept on the same row purely to avoid a second single-row
// table, not because they're user settings. Mirrors the split in
// chamber-map/src/db/schema.ts's own settings table.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  hevyApiKey: text("hevy_api_key"),
  hevyLastSyncedAt: integer("hevy_last_synced_at", { mode: "timestamp_ms" }),
  hevyConsecutiveFailures: integer("hevy_consecutive_failures").notNull().default(0),
  hevyLastPollError: text("hevy_last_poll_error"),
});
