import { z } from "zod";
import { actorSchema } from "./events.js";

// Congress's own AI capability (services/congress/src/ai/) - the headless
// `claude` engine, its concurrency-1 job queue, the shared budget/pause
// guardrails, and the owner-facing chat. Chambers never spawn `claude`
// themselves: they call POST /congress/ai/run (internal token) and get the
// same queue and guardrails as the chat.

export const aiMessageSchema = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const postAiChatMessageRequestSchema = z.object({
  text: z.string().min(1),
});
export type PostAiChatMessageRequest = z.infer<typeof postAiChatMessageRequestSchema>;

export const postAiChatMessageResponseSchema = z.object({
  userMessage: aiMessageSchema,
  assistantMessage: aiMessageSchema,
});
export type PostAiChatMessageResponse = z.infer<typeof postAiChatMessageResponseSchema>;

// One tool call parsed out of a run's stream-json transcript - see
// services/congress/src/ai/engine.ts's spawnClaude for how tool_use/
// tool_result blocks are paired up.
export const aiTranscriptEntrySchema = z.object({
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
});
export type AiTranscriptEntry = z.infer<typeof aiTranscriptEntrySchema>;

export const aiSettingsSchema = z.object({
  // Free-text background handed to every run, chat or remote.
  contextPrompt: z.string(),
  chatIdleWindowMs: z.number().int().positive(),
  // One daily cap shared by chat and every Chamber's remote runs.
  budgetCapUsd: z.number().positive(),
  model: z.string().min(1),
  retentionDays: z.number().int().positive(),
  paused: z.boolean(),
  pausedReason: z.string().nullable(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const updateAiSettingsRequestSchema = aiSettingsSchema.partial();
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;

// Opaque caller metadata echoed back on the run stream (run_started), so a
// Chamber's own frontend can tell its runs apart from everyone else's -
// e.g. Deputy's progress rings key off { chamber: "deputy", directiveId }.
export const aiRunMetaSchema = z.record(z.string(), z.unknown());
export type AiRunMeta = z.infer<typeof aiRunMetaSchema>;

export const aiRunRequestSchema = z.object({
  // The caller's own instructions for this run - Congress prepends its base
  // identity and the owner's context prompt, nothing else.
  prompt: z.string().min(1),
  // Attributed on every MCP tool call this run makes (ACTOR_HEADER), so
  // side-effect events name the Chamber that asked, not the owner.
  actor: actorSchema,
  meta: aiRunMetaSchema.default({}),
});
export type AiRunRequest = z.infer<typeof aiRunRequestSchema>;

// A refused run (paused, over budget) comes back ok:false with
// `refused: true` and never spawned anything - callers that buffer work
// (Deputy's pending events) can tell "try again later" from "ran and failed".
export const aiRunResultSchema = z.object({
  ok: z.boolean(),
  refused: z.boolean(),
  response: z.string().nullable(),
  errorMessage: z.string().nullable(),
  transcript: z.array(aiTranscriptEntrySchema),
  costUsd: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  durationMs: z.number(),
});
export type AiRunResult = z.infer<typeof aiRunResultSchema>;

export type AiRunKind = "chat" | "remote";

// Server-sent on GET /congress/ai/runs/stream. The job queue is
// concurrency-1, so there is at most one active run at a time.
export type AiRunProgressEvent =
  | { type: "run_started"; runId: string; kind: AiRunKind; meta: AiRunMeta; startedAt: number }
  | { type: "tool_start"; runId: string; toolName: string; input: unknown }
  | { type: "tool_result"; runId: string; toolName: string; output: unknown; error: string | null }
  | { type: "assistant_text"; runId: string; text: string }
  | { type: "run_finished"; runId: string; ok: boolean; response: string | null; errorMessage: string | null };
