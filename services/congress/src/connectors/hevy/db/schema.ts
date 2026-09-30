import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// The Hevy connector's cache: workouts and routines (Hevy owns both), the
// routine folders, the poll cursor and the API key.

export const workouts = sqliteTable("workouts", {
  hevyId: text("hevy_id").primaryKey(),
  title: text("title").notNull(),
  startTime: integer("start_time").notNull(),
  endTime: integer("end_time").notNull(),
  exerciseCount: integer("exercise_count").notNull().default(0),
  // Null when no set carries weight (e.g. cardio), not 0.
  totalVolumeKg: real("total_volume_kg"),
  exercisesJson: text("exercises_json").notNull(),
  exerciseNames: text("exercise_names").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const routines = sqliteTable("routines", {
  hevyId: text("hevy_id").primaryKey(),
  title: text("title").notNull(),
  folderId: integer("folder_id"),
  exercisesJson: text("exercises_json").notNull(),
  hevyUpdatedAt: text("hevy_updated_at"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  apiKey: text("api_key"),
  // Latest workout event seen (Hevy's /workouts/events `since`).
  cursor: text("cursor"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  // Off while the Fitness Chamber still runs (it publishes fitness.* itself).
  publishEvents: integer("publish_events", { mode: "boolean" }).notNull().default(false),
});
