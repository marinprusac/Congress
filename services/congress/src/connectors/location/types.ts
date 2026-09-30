import { z } from "zod";

// A Place record as tracking reads it (the connector's mirror of type "place").
export interface PlaceSummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export const visitStatusSchema = z.enum(["confirmed", "pending", "adhoc", "ignored"]);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

// placeName/latitude/longitude are denormalized onto the visit at read time
// (a join, not stored) so the frontend/MCP tools never need a second lookup -
// see visits.ts's toVisit. latitude/longitude are the place's own coordinates
// for a confirmed visit, or clusterLatitude/clusterLongitude for a
// pending/adhoc/ignored one - whichever is set.
export const visitSchema = z.object({
  id: z.number().int(),
  placeId: z.string().nullable(),
  placeName: z.string().nullable(),
  status: visitStatusSchema,
  adhocLabel: z.string().nullable(),
  clusterLatitude: z.number().nullable(),
  clusterLongitude: z.number().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  arrivedAt: z.string(),
  departedAt: z.string().nullable(),
  durationMinutes: z.number().nullable(),
});
export type Visit = z.infer<typeof visitSchema>;

export const classifyVisitRequestSchema = z.discriminatedUnion("action", [
  // A new place is a Place record the owner creates first; then it's assigned.
  z.object({ action: z.literal("assign_place"), placeId: z.string().min(1) }),
  z.object({ action: z.literal("adhoc_label"), label: z.string().min(1) }),
  z.object({ action: z.literal("ignore") }),
]);
export type ClassifyVisitRequest = z.infer<typeof classifyVisitRequestSchema>;

export const tripModeSchema = z.enum(["walk", "bike", "transit", "unknown"]);
export type TripMode = z.infer<typeof tripModeSchema>;

export const tripSchema = z.object({
  id: z.number().int(),
  fromVisitId: z.number().int(),
  toVisitId: z.number().int(),
  fromPlaceId: z.string().nullable(),
  toPlaceId: z.string().nullable(),
  fromLabel: z.string(),
  toLabel: z.string(),
  departedAt: z.string(),
  arrivedAt: z.string(),
  durationMinutes: z.number(),
  distanceKm: z.number(),
  mode: tripModeSchema,
  // The actual GPS fixes recorded in transit, ascending by time - what the
  // frontend draws as the trip's line on the map. Null only for a trip whose
  // in-memory accumulator was lost to a Chamber restart mid-trip.
  path: z.array(z.object({ latitude: z.number(), longitude: z.number() })).nullable(),
});
export type Trip = z.infer<typeof tripSchema>;

// Only the user-facing tunables - see db/schema.ts's comment on why
// lastProcessedAt/lastPollSucceededAt/lastPollError live on the same table
// row but outside this type.
export const settingsSchema = z.object({
  unknownClusterRadiusMeters: z.number().int(),
  minDwellMs: z.number().int(),
  stoppedSpeedKmh: z.number(),
  pollIntervalMs: z.number().int(),
  staleThresholdMs: z.number().int(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({
  unknownClusterRadiusMeters: z.number().int().positive().optional(),
  minDwellMs: z.number().int().positive().optional(),
  stoppedSpeedKmh: z.number().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  staleThresholdMs: z.number().int().positive().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

// The poll loop's own health, surfaced on the Settings page - see
// pollState.ts.
export const pollHealthSchema = z.object({
  lastProcessedAt: z.string().nullable(),
  lastPollSucceededAt: z.string().nullable(),
  lastPollError: z.string().nullable(),
});
export type PollHealth = z.infer<typeof pollHealthSchema>;

// Rebuilding visits/trips from the raw position log - see reprocess.ts.
// `from` omitted means "as far back as there are positions"; `to` omitted
// means now.
export const reprocessRequestSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ReprocessRequest = z.infer<typeof reprocessRequestSchema>;

export const reprocessResultSchema = z.object({
  from: z.string(),
  to: z.string(),
  positionsReplayed: z.number().int(),
  visitsDeleted: z.number().int(),
  visitsCreated: z.number().int(),
  tripsDeleted: z.number().int(),
  tripsCreated: z.number().int(),
  // Owner-authored adhoc labels, ignored dwells and trip labels that were
  // carried across the rebuild, and how many found nothing to reattach to.
  annotationsRestored: z.number().int(),
  annotationsLost: z.number().int(),
});
export type ReprocessResult = z.infer<typeof reprocessResultSchema>;
