import { z } from "zod";
import { priorityLevelSchema } from "@congress/shared-types";

export const logRuleSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  triggerEventType: z.string(),
  conditionField: z.string().nullable(),
  conditionEquals: z.string().nullable(),
  minPriority: priorityLevelSchema.nullable(),
  recordToHistory: z.boolean(),
  historyRetentionMs: z.number().int().positive().nullable(),
  notify: z.boolean(),
  notifyTitleTemplate: z.string().nullable(),
  notifyBodyTemplate: z.string().nullable(),
  notifyUrlTemplate: z.string().nullable(),
  notifyDedupeKeyTemplate: z.string().nullable(),
  enabled: z.boolean(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LogRuleSummary = z.infer<typeof logRuleSummarySchema>;

export const logRuleDetailSchema = logRuleSummarySchema;
export type LogRuleDetail = z.infer<typeof logRuleDetailSchema>;

// A rule that does neither is a no-op the owner almost certainly didn't
// intend - same refine shape as the old automations' single
// "actionTitleTemplate required when pushing" check. notify's own
// title/body/url/dedupe-key templates are all optional inputs now - the
// owner never has to fill them in, since eventPoller.ts falls back to the
// rule's own title/id when they're unset.
const logRuleBaseSchema = z.object({
  recordToHistory: z.boolean(),
  notify: z.boolean(),
});
function refineLogRuleAction<T extends z.infer<typeof logRuleBaseSchema>>(v: T) {
  return v.recordToHistory || v.notify;
}

export const createLogRuleRequestSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().default(""),
    triggerEventType: z.string().min(1),
    conditionField: z.string().optional(),
    conditionEquals: z.string().optional(),
    minPriority: priorityLevelSchema.optional(),
    recordToHistory: z.boolean().default(true),
    historyRetentionMs: z.number().int().positive().optional(),
    notify: z.boolean().default(false),
    notifyTitleTemplate: z.string().optional(),
    notifyBodyTemplate: z.string().optional(),
    notifyUrlTemplate: z.string().optional(),
    notifyDedupeKeyTemplate: z.string().optional(),
    enabled: z.boolean().default(true),
  })
  .refine(refineLogRuleAction, { message: "a rule must record to history, notify, or both", path: ["recordToHistory"] });
export type CreateLogRuleRequest = z.infer<typeof createLogRuleRequestSchema>;

export const updateLogRuleRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  triggerEventType: z.string().min(1).optional(),
  conditionField: z.string().nullable().optional(),
  conditionEquals: z.string().nullable().optional(),
  minPriority: priorityLevelSchema.nullable().optional(),
  recordToHistory: z.boolean().optional(),
  historyRetentionMs: z.number().int().positive().nullable().optional(),
  notify: z.boolean().optional(),
  notifyTitleTemplate: z.string().nullable().optional(),
  notifyBodyTemplate: z.string().nullable().optional(),
  notifyUrlTemplate: z.string().nullable().optional(),
  notifyDedupeKeyTemplate: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateLogRuleRequest = z.infer<typeof updateLogRuleRequestSchema>;

// One row of durable history - see db/schema.ts's eventHistory for why this
// is append-only rather than upserted like notifications.
export const eventHistoryEntrySchema = z.object({
  id: z.number().int(),
  ruleId: z.number().int(),
  ruleTitle: z.string(),
  chamber: z.string(),
  type: z.string(),
  priority: priorityLevelSchema,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export type EventHistoryEntry = z.infer<typeof eventHistoryEntrySchema>;

export const settingsSchema = z.object({});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
