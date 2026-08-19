import { z } from "zod";

export const automationSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  triggerEventType: z.string(),
  conditionField: z.string().nullable(),
  conditionEquals: z.string().nullable(),
  targetChamber: z.string(),
  toolName: z.string(),
  argsTemplate: z.record(z.string(), z.string()),
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
  targetChamber: z.string().min(1),
  toolName: z.string().min(1),
  argsTemplate: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});
export type CreateAutomationRequest = z.infer<typeof createAutomationRequestSchema>;

export const updateAutomationRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  triggerEventType: z.string().min(1).optional(),
  conditionField: z.string().nullable().optional(),
  conditionEquals: z.string().nullable().optional(),
  targetChamber: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  argsTemplate: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>;

// A bounded log entry from an automation's last few firings - see
// db/schema.ts's automationRuns for why this isn't Exhibit content.
export const automationRunSchema = z.object({
  id: z.number().int(),
  automationId: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
  targetChamber: z.string(),
  toolName: z.string(),
  ok: z.boolean(),
  result: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  firedAt: z.string(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const settingsSchema = z.object({});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
