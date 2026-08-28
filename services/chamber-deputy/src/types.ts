import { z } from "zod";
import { priorityLevelSchema } from "@congress/shared-types";

export const directiveSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  // This directive's own schedule - null means it only ever runs on demand
  // (the play button) or as part of an urgent/chat bundle. See
  // db/schema.ts's own comment and checkup.ts.
  intervalMs: z.number().int().positive().nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DirectiveSummary = z.infer<typeof directiveSummarySchema>;

export const directiveDetailSchema = directiveSummarySchema;
export type DirectiveDetail = z.infer<typeof directiveDetailSchema>;

export const createDirectiveRequestSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().positive().nullable().default(null),
});
export type CreateDirectiveRequest = z.infer<typeof createDirectiveRequestSchema>;

export const updateDirectiveRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
  intervalMs: z.number().int().positive().nullable().optional(),
});
export type UpdateDirectiveRequest = z.infer<typeof updateDirectiveRequestSchema>;

export const messageSchema = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const postChatMessageRequestSchema = z.object({
  text: z.string().min(1),
});
export type PostChatMessageRequest = z.infer<typeof postChatMessageRequestSchema>;

export const postChatMessageResponseSchema = z.object({
  userMessage: messageSchema,
  assistantMessage: messageSchema,
});
export type PostChatMessageResponse = z.infer<typeof postChatMessageResponseSchema>;

// One tool call parsed out of a run's stream-json transcript - see
// engine.ts's spawnClaude for how tool_use/tool_result blocks are paired up.
export const deputyTranscriptEntrySchema = z.object({
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
});
export type DeputyTranscriptEntry = z.infer<typeof deputyTranscriptEntrySchema>;

// "scheduled" - this directive's own timer came due (checkup.ts).
// "manual" - the owner hit the play button on one directive.
// "chat"/"urgent" still bundle every enabled directive into one prompt,
// unchanged from before this split.
export const deputyRunTriggerSchema = z.enum(["chat", "scheduled", "urgent", "manual"]);
export type DeputyRunTrigger = z.infer<typeof deputyRunTriggerSchema>;

export const settingsSchema = z.object({
  contextPrompt: z.string(),
  chatIdleWindowMs: z.number().int().positive(),
  budgetCapUsd: z.number().positive(),
  model: z.string().min(1),
  retentionDays: z.number().int().positive(),
  paused: z.boolean(),
  pausedReason: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({
  contextPrompt: z.string().optional(),
  chatIdleWindowMs: z.number().int().positive().optional(),
  budgetCapUsd: z.number().positive().optional(),
  model: z.string().min(1).optional(),
  retentionDays: z.number().int().positive().optional(),
  paused: z.boolean().optional(),
  pausedReason: z.string().nullable().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export { priorityLevelSchema };
