import { z } from "zod";

// The AI's memory: things it was asked to track (with their own check
// schedule) and plain facts about the owner. Both editable by the owner.

export const recurrenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(5).max(60 * 24 * 90) }),
  z.object({ type: z.literal("daily"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({
    type: z.literal("weekly"),
    // 0 = Sunday … 6 = Saturday
    dayOfWeek: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const watchEventSchema = z.object({
  type: z.string().min(1).max(128),
  // Run a check for this item as soon as the event happens.
  immediate: z.boolean().default(false),
});
export type WatchEvent = z.infer<typeof watchEventSchema>;

export const trackingStatusSchema = z.enum(["active", "paused", "done", "dropped"]);
export type TrackingStatus = z.infer<typeof trackingStatusSchema>;

export const trackedItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  status: trackingStatusSchema,
  watchEvents: z.array(watchEventSchema),
  nextCheckAt: z.string().nullable(),
  recurrence: recurrenceSchema.nullable(),
  refs: z.array(z.string()),
  threadId: z.number().int().nullable(),
  source: z.enum(["chat", "ai", "directive", "owner"]),
  lastCheckedAt: z.string().nullable(),
  checking: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrackedItem = z.infer<typeof trackedItemSchema>;

export const updateTrackedItemRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(4000).optional(),
  status: trackingStatusSchema.optional(),
  watchEvents: z.array(watchEventSchema).max(20).optional(),
  nextCheckAt: z.string().datetime({ offset: true }).nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  refs: z.array(z.string()).max(20).optional(),
});
export type UpdateTrackedItemRequest = z.infer<typeof updateTrackedItemRequestSchema>;

export const factSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  source: z.enum(["ai", "owner"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Fact = z.infer<typeof factSchema>;

export const FACT_MAX_LENGTH = 500;
export const factTextSchema = z.string().trim().min(1).max(FACT_MAX_LENGTH);
