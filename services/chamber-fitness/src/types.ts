import { z } from "zod";

// Mirrors Hevy's own set shape (api.hevyapp.com/docs) closely enough to
// round-trip without lossy coercion - most numeric fields are nullable
// there too, to accommodate weight-based/duration-based/distance-based
// exercises sharing one shape.
export const workoutSetSchema = z.object({
  index: z.number().int(),
  type: z.enum(["normal", "warmup", "dropset", "failure"]),
  weightKg: z.number().nullable(),
  reps: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  distanceMeters: z.number().nullable(),
  rpe: z.number().nullable(),
});
export type WorkoutSet = z.infer<typeof workoutSetSchema>;

export const workoutExerciseSchema = z.object({
  name: z.string(),
  sets: z.array(workoutSetSchema),
});
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;

export const workoutSummarySchema = z.object({
  id: z.number().int(),
  hevyId: z.string(),
  title: z.string(),
  // The composed, unique-per-workout "<title> · <date> (n)" Exhibit name
  // (see workoutTitle.ts) - what the frontend displays. `title` above is
  // the raw Hevy name, kept for filtering and Hevy round-tripping.
  exhibitTitle: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  exerciseCount: z.number().int(),
  totalVolumeKg: z.number().nullable(),
});
export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;

export const workoutDetailSchema = workoutSummarySchema.extend({
  exercises: z.array(workoutExerciseSchema),
});
export type WorkoutDetail = z.infer<typeof workoutDetailSchema>;

export const settingsSchema = z.object({
  hevyApiKey: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({
  hevyApiKey: z.string().trim().min(1).nullable(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// The Hevy poll loop's own health, surfaced on the Settings page - see
// hevy/pollState.ts. Deliberately not part of Settings/PUT /api/settings,
// same split as chamber-map's PollHealth.
export const hevySyncHealthSchema = z.object({
  lastSyncedAt: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastError: z.string().nullable(),
});
export type HevySyncHealth = z.infer<typeof hevySyncHealthSchema>;
