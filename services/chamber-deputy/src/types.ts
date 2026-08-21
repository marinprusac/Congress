import { z } from "zod";
import { priorityLevelSchema } from "@congress/shared-types";

export const directiveSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  // Whether this directive needs the periodic checkup to wake it even with
  // no new event pending - see db/schema.ts's own comment and checkup.ts.
  timeBased: z.boolean(),
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
  timeBased: z.boolean().default(true),
});
export type CreateDirectiveRequest = z.infer<typeof createDirectiveRequestSchema>;

export const updateDirectiveRequestSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
  timeBased: z.boolean().optional(),
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
  // Forces a fresh session id regardless of the idle window - the chat
  // page's own "New thread" affordance, independent of timeout-based
  // resets (see docs/deputy-chamber-plan.md §8).
  newThread: z.boolean().default(false),
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

export const deputyRunTriggerSchema = z.enum(["chat", "periodic", "urgent"]);
export type DeputyRunTrigger = z.infer<typeof deputyRunTriggerSchema>;

export const deputyRunSchema = z.object({
  id: z.number().int(),
  trigger: deputyRunTriggerSchema,
  sessionId: z.string().nullable(),
  prompt: z.string(),
  transcript: z.array(deputyTranscriptEntrySchema),
  finalResponse: z.string().nullable(),
  ok: z.boolean(),
  errorMessage: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
});
export type DeputyRun = z.infer<typeof deputyRunSchema>;

export const settingsSchema = z.object({
  personaPrompt: z.string(),
  checkupIntervalMs: z.number().int().positive(),
  chatIdleWindowMs: z.number().int().positive(),
  budgetCapUsd: z.number().positive(),
  model: z.string().min(1),
  retentionDays: z.number().int().positive(),
  paused: z.boolean(),
  pausedReason: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsRequestSchema = z.object({
  personaPrompt: z.string().optional(),
  checkupIntervalMs: z.number().int().positive().optional(),
  chatIdleWindowMs: z.number().int().positive().optional(),
  budgetCapUsd: z.number().positive().optional(),
  model: z.string().min(1).optional(),
  retentionDays: z.number().int().positive().optional(),
  paused: z.boolean().optional(),
  pausedReason: z.string().nullable().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export { priorityLevelSchema };
