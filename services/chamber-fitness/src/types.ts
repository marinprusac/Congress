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
  healthIngestToken: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

// Both fields are .optional() (in addition to .nullable()) because a PUT
// only ever carries the one field its own form section changed (see
// SettingsPage.tsx) - a required field here would 400 whenever the other
// section's autosave fires.
export const updateSettingsRequestSchema = z.object({
  hevyApiKey: z.string().trim().min(1).nullable().optional(),
  healthIngestToken: z.string().trim().min(1).nullable().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// Apple's own quantity-sample distinction: weight/vo2Max are instantaneous
// (one reading at a point in time), activeEnergy/restingEnergy/sleepAsleep
// are cumulative over an interval - both shapes are stored the same way
// (see healthMetrics table), with startDate == endDate for the former.
export const healthMetricTypeSchema = z.enum(["weight", "vo2Max", "activeEnergy", "restingEnergy", "sleepAsleep"]);
export type HealthMetricType = z.infer<typeof healthMetricTypeSchema>;

// One Apple Health sample, shaped so a real, non-technical iOS Shortcut can
// assemble it with native actions only ("Find Health Samples" -> "Repeat
// with Each" -> append a dictionary built from Shortcuts' own
// Quantity/Start Date/End Date/Source magic variables to a list) - no
// scripting step required. `endDate` is optional on the wire purely so a
// Shortcut built against an instantaneous sample (weight/vo2Max) doesn't
// have to wire up a second dictionary key that would just repeat Start Date;
// it defaults to startDate server-side.
export const healthSampleSchema = z.object({
  metricType: healthMetricTypeSchema,
  value: z.number(),
  unit: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }).optional(),
  sourceName: z.string().optional(),
});
export type HealthSample = z.infer<typeof healthSampleSchema>;

// The whole POST body - one request per Shortcut run, one array of samples.
// Shortcuts' "Get Contents of URL" JSON body is a single list-of-dictionaries
// variable built by "Repeat with Each" appending to it, not one request per
// sample (which would mean scripting a loop of network calls in the Shortcut).
export const healthIngestRequestSchema = z.object({
  samples: z.array(healthSampleSchema).min(1).max(2000),
});
export type HealthIngestRequest = z.infer<typeof healthIngestRequestSchema>;

export const healthIngestResultSchema = z.object({
  accepted: z.number().int(),
  rejected: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
});
export type HealthIngestResult = z.infer<typeof healthIngestResultSchema>;

export const healthMetricSchema = z.object({
  id: z.number().int(),
  metricType: healthMetricTypeSchema,
  value: z.number(),
  unit: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  sourceName: z.string().nullable(),
});
export type HealthMetric = z.infer<typeof healthMetricSchema>;

// Latest known value per tracked metric type - powers the Settings-page-
// adjacent snapshot and the homepage widget. A type absent from the map
// means nothing has ever been ingested for it yet.
export type HealthLatest = Partial<Record<HealthMetricType, HealthMetric>>;

// The Hevy poll loop's own health, surfaced on the Settings page - see
// hevy/pollState.ts. Deliberately not part of Settings/PUT /api/settings,
// same split as chamber-map's PollHealth.
export const hevySyncHealthSchema = z.object({
  lastSyncedAt: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastError: z.string().nullable(),
});
export type HevySyncHealth = z.infer<typeof hevySyncHealthSchema>;
