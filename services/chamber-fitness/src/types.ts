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

// The wire format is the Health Auto Export iOS app's own export shape, not
// something we designed: `{"metrics": [{name, units, data: [...]}], ...}`,
// each metric entry's own fields varying by metric (a quantity sample
// carries `qty`/`date`/`source`; sleep_analysis carries `totalSleep`/
// `sleepStart`/`sleepEnd`/... instead) - the export always includes
// whatever the owner has enabled in the app, not just what we track, so
// entries are validated loosely here and interpreted defensively in
// health/normalize.ts, the same "tolerant of an external service's own
// field-name choices" spirit as hevy/normalize.ts. The app's in-app REST
// Automation (a paid-tier feature) wraps this in an outer `{"data": {...}}`
// envelope; its Shortcuts export action - the only option on the Basic
// tier, called from a hand-built Shortcut instead - has been observed
// sending the same content unwrapped. The preprocess step below accepts
// either, unwrapping `data` when present rather than requiring one specific
// envelope.
const healthAutoExportEntrySchema = z.record(z.string(), z.unknown());

const healthAutoExportMetricSchema = z.object({
  name: z.string(),
  units: z.string().optional(),
  data: z.array(healthAutoExportEntrySchema),
});

const healthAutoExportBodySchema = z
  .object({
    metrics: z.array(healthAutoExportMetricSchema).default([]),
  })
  .passthrough();

export const healthIngestRequestSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && "data" in raw) return (raw as { data: unknown }).data;
  return raw;
}, healthAutoExportBodySchema);
export type HealthIngestRequest = z.infer<typeof healthAutoExportBodySchema>;

export const healthIngestResultSchema = z.object({
  // Genuinely new rows only - see duplicated below for resends.
  accepted: z.number().int(),
  // A sample whose (metricType, startDate, endDate) already existed -
  // updated in place (its value can legitimately change, e.g. a
  // still-accumulating daily energy total), but not a new data point, so
  // counted separately from accepted rather than folded into it - useful
  // for sanity-checking a bulk backfill ("how much of this did I already
  // have?").
  duplicated: z.number().int(),
  // Entries present in the export but not one of our tracked metric types
  // (e.g. resting_heart_rate), or missing a field normalize.ts needs - not
  // an error, just "not something we track" or "malformed", silently
  // dropped rather than 400ing the whole batch over one export's worth of
  // metrics we don't care about.
  skipped: z.number().int(),
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
