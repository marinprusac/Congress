import { z } from "zod";

export const automationSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  triggerEventType: z.string(),
  conditionField: z.string().nullable(),
  conditionEquals: z.string().nullable(),
  actionTitleTemplate: z.string().nullable(),
  actionBodyTemplate: z.string().nullable(),
  actionUrlTemplate: z.string().nullable(),
  actionDedupeKeyTemplate: z.string(),
  enabled: z.boolean(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AutomationSummary = z.infer<typeof automationSummarySchema>;

export const automationDetailSchema = automationSummarySchema;
export type AutomationDetail = z.infer<typeof automationDetailSchema>;

export const createAutomationRequestSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
  triggerEventType: z.string().min(1),
  conditionField: z.string().optional(),
  conditionEquals: z.string().optional(),
  actionTitleTemplate: z.string().min(1),
  actionBodyTemplate: z.string().optional(),
  actionUrlTemplate: z.string().optional(),
  actionDedupeKeyTemplate: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type CreateAutomationRequest = z.infer<typeof createAutomationRequestSchema>;

export const updateAutomationRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  triggerEventType: z.string().min(1).optional(),
  conditionField: z.string().nullable().optional(),
  conditionEquals: z.string().nullable().optional(),
  actionTitleTemplate: z.string().nullable().optional(),
  actionBodyTemplate: z.string().nullable().optional(),
  actionUrlTemplate: z.string().nullable().optional(),
  actionDedupeKeyTemplate: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>;

// A bounded log entry from an automation's last few firings - see
// db/schema.ts's automationRuns for why this isn't Exhibit content.
export const automationRunSchema = z.object({
  id: z.number().int(),
  automationId: z.number().int(),
  eventId: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
  resultTitle: z.string().nullable(),
  resultBody: z.string().nullable(),
  firedAt: z.string(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const settingsSchema = z.object({});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
