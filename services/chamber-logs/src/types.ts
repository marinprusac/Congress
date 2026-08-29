import { z } from "zod";
import { manifestEventFieldSchema } from "@congress/shared-types";

// One row per known event type - auto-derived by eventCatalogSync.ts, never
// user-created/deleted (see eventSettings.ts). eventType/chamber/label/
// description/payloadFields are a read-only cache of that event's own
// manifest catalog entry; everything else is the owner's own configuration.
export const eventSettingsSummarySchema = z.object({
  id: z.number().int(),
  eventType: z.string(),
  chamber: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  // Known {{payload.x}} paths for this event type, for the notify-template
  // inputs' field picker - null when the publisher declared no fields.
  payloadFields: z.record(z.string(), manifestEventFieldSchema).nullable(),
  recordToHistory: z.boolean(),
  historyRetentionMs: z.number().int().positive().nullable(),
  notify: z.boolean(),
  notifyTitleTemplate: z.string().nullable(),
  notifyBodyTemplate: z.string().nullable(),
  notifyUrlTemplate: z.string().nullable(),
  notifyDedupeKeyTemplate: z.string().nullable(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventSettingsSummary = z.infer<typeof eventSettingsSummarySchema>;

export const eventSettingsDetailSchema = eventSettingsSummarySchema;
export type EventSettingsDetail = z.infer<typeof eventSettingsDetailSchema>;

// The only mutable subset - eventType/chamber/label/description are
// read-only, refreshed by eventCatalogSync.ts, not editable through this
// request.
export const updateEventSettingsRequestSchema = z.object({
  recordToHistory: z.boolean().optional(),
  historyRetentionMs: z.number().int().positive().nullable().optional(),
  notify: z.boolean().optional(),
  notifyTitleTemplate: z.string().nullable().optional(),
  notifyBodyTemplate: z.string().nullable().optional(),
  notifyUrlTemplate: z.string().nullable().optional(),
  notifyDedupeKeyTemplate: z.string().nullable().optional(),
});
export type UpdateEventSettingsRequest = z.infer<typeof updateEventSettingsRequestSchema>;

// One row of durable history - see db/schema.ts's eventHistory for why this
// is append-only rather than upserted like notifications. `label` is the
// recording event type's own display label at query time (falling back to
// the raw type string if that settings row has since gone stale).
export const eventHistoryEntrySchema = z.object({
  id: z.number().int(),
  label: z.string(),
  chamber: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type EventHistoryEntry = z.infer<typeof eventHistoryEntrySchema>;

export const settingsSchema = z.object({});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
