import { z } from "zod";
import { actorSchema } from "./events.js";

// Congress's own AI capability (services/congress/src/ai/) - the headless
// `claude` engine, its concurrency-1 job queue, the shared budget/pause
// guardrails, and the owner-facing chat. Chambers never spawn `claude`
// themselves: they call POST /congress/ai/run (internal token) and get the
// same queue and guardrails as the chat.

export const aiMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type AiMessageRole = z.infer<typeof aiMessageRoleSchema>;

// text: plain chat turn. message/question/proposal: AI-authored asks.
// answer/decision: the owner's reply to a question/proposal. notice: system.
export const aiMessageKindSchema = z.enum(["text", "message", "question", "proposal", "answer", "decision", "notice"]);
export type AiMessageKind = z.infer<typeof aiMessageKindSchema>;

export const aiMessageStatusSchema = z.enum(["ok", "error", "refused", "cancelled"]);
export type AiMessageStatus = z.infer<typeof aiMessageStatusSchema>;

export const aiAskStateSchema = z.enum(["open", "answered", "expired", "withdrawn", "approved", "rejected", "executed", "failed"]);
export type AiAskState = z.infer<typeof aiAskStateSchema>;

export const aiUrgencySchema = z.enum(["quiet", "push"]);
export type AiUrgency = z.infer<typeof aiUrgencySchema>;

export const aiRunStatusSchema = z.enum(["running", "ok", "error", "refused", "cancelled"]);
export type AiRunStatus = z.infer<typeof aiRunStatusSchema>;

// What a run did, in order: interim assistant text ("notes") and tool calls.
export const aiActivityEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    toolUseId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    output: z.unknown().nullable(),
    error: z.string().nullable(),
  }),
]);
export type AiActivityEntry = z.infer<typeof aiActivityEntrySchema>;

export const aiMessageRunSchema = z.object({
  id: z.string(),
  status: aiRunStatusSchema,
  toolCallCount: z.number().int(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
});
export type AiMessageRun = z.infer<typeof aiMessageRunSchema>;

export const aiMessageSchema = z.object({
  id: z.number().int(),
  threadId: z.number().int(),
  role: aiMessageRoleSchema,
  kind: aiMessageKindSchema,
  status: aiMessageStatusSchema,
  text: z.string(),
  runId: z.string().nullable(),
  run: aiMessageRunSchema.nullable(),
  payload: z.unknown().nullable(),
  askState: aiAskStateSchema.nullable(),
  urgency: aiUrgencySchema.nullable(),
  deliverAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const aiThreadSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  origin: z.enum(["owner", "ai"]),
  trackingId: z.number().int().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  unread: z.boolean(),
  openAskCount: z.number().int(),
  pendingRunId: z.string().nullable(),
  snippet: z.string().nullable(),
  lastMessageAt: z.string(),
  createdAt: z.string(),
});
export type AiThread = z.infer<typeof aiThreadSchema>;

export const AI_MESSAGE_MAX_LENGTH = 20_000;

export const createAiThreadRequestSchema = z.object({
  text: z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH).optional(),
  title: z.string().trim().min(1).max(120).optional(),
});
export type CreateAiThreadRequest = z.infer<typeof createAiThreadRequestSchema>;

export const updateAiThreadRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type UpdateAiThreadRequest = z.infer<typeof updateAiThreadRequestSchema>;

export const postAiThreadMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(AI_MESSAGE_MAX_LENGTH),
});
export type PostAiThreadMessageRequest = z.infer<typeof postAiThreadMessageRequestSchema>;

export const postAiThreadMessageResponseSchema = z.object({
  userMessage: aiMessageSchema,
  runId: z.string(),
});
export type PostAiThreadMessageResponse = z.infer<typeof postAiThreadMessageResponseSchema>;

export const createAiThreadResponseSchema = z.object({
  thread: aiThreadSchema,
  runId: z.string().nullable(),
});
export type CreateAiThreadResponse = z.infer<typeof createAiThreadResponseSchema>;

// Newest-last page; `before` pagination walks backwards by message id.
export const aiThreadMessagesPageSchema = z.object({
  messages: z.array(aiMessageSchema),
  hasMore: z.boolean(),
});
export type AiThreadMessagesPage = z.infer<typeof aiThreadMessagesPageSchema>;

export const aiRunDetailSchema = z.object({
  id: z.string(),
  threadId: z.number().int().nullable(),
  kind: z.string(),
  trigger: z.string().nullable(),
  actor: z.string(),
  model: z.string().nullable(),
  status: aiRunStatusSchema,
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  durationMs: z.number().nullable(),
  toolCallCount: z.number().int(),
  activity: z.array(aiActivityEntrySchema),
  verdict: z.unknown().nullable(),
});
export type AiRunDetail = z.infer<typeof aiRunDetailSchema>;

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
  // One daily cap shared by chat and every Chamber's remote runs.
  budgetCapUsd: z.number().positive(),
  model: z.string().min(1),
  retentionDays: z.number().int().positive(),
  paused: z.boolean(),
  pausedReason: z.string().nullable(),
  // Asks: at most this many pushes a day; none during quiet hours (local).
  maxPushesPerDay: z.number().int().min(0).max(50),
  quietHoursStart: z.number().int().min(0).max(23).nullable(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable(),
  timeZone: z.string().max(64).nullable(),
  // Proactive AI: runs it starts on its own (checks, the gate, proactive runs).
  proactiveEnabled: z.boolean(),
  proactiveBudgetUsd: z.number().min(0),
  gateModel: z.string().min(1),
  gateSensitivity: z.enum(["low", "normal", "high"]),
  heartbeatHours: z.number().min(0.5).max(48),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const updateAiSettingsRequestSchema = aiSettingsSchema.partial();
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;

// Opaque caller metadata echoed back on the run stream (run_started), so a
// Chamber's own frontend can tell its runs apart from everyone else's -
// e.g. a tracked item's check carries { trackingId }.
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
  cancelled: z.boolean().optional(),
  response: z.string().nullable(),
  errorMessage: z.string().nullable(),
  transcript: z.array(aiTranscriptEntrySchema),
  costUsd: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  durationMs: z.number(),
});
export type AiRunResult = z.infer<typeof aiRunResultSchema>;

// chat/answer: the owner's threads. remote: a Chamber's POST /run.
// proactive/tracking/gate: runs Congress starts on its own.
export type AiRunKind = "chat" | "answer" | "remote" | "proactive" | "tracking" | "gate";

// Server-sent on GET /congress/ai/runs/stream. The job queue is
// concurrency-1, so there is at most one active run at a time.
// Live text: assistant_delta appends, assistant_text replaces, and
// assistant_note commits the current text as an interim note (before a tool).
export type AiRunProgressEvent =
  | { type: "run_started"; runId: string; kind: AiRunKind; meta: AiRunMeta; threadId: number | null; startedAt: number }
  | { type: "assistant_delta"; runId: string; text: string }
  | { type: "assistant_text"; runId: string; text: string }
  | { type: "assistant_note"; runId: string; text: string }
  | { type: "tool_start"; runId: string; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; runId: string; toolUseId: string; toolName: string; output: unknown; error: string | null }
  | {
      type: "run_finished";
      runId: string;
      threadId: number | null;
      status: AiRunStatus;
      ok: boolean;
      response: string | null;
      errorMessage: string | null;
    };

export const aiQueueEntrySchema = z.object({
  runId: z.string(),
  kind: z.string(),
  threadId: z.number().int().nullable(),
  meta: aiRunMetaSchema,
});
export type AiQueueEntry = z.infer<typeof aiQueueEntrySchema>;

export const aiQueueSnapshotSchema = z.object({
  running: aiQueueEntrySchema.nullable(),
  waiting: z.array(aiQueueEntrySchema),
});
export type AiQueueSnapshot = z.infer<typeof aiQueueSnapshotSchema>;

// Stream events not tied to one run's progress.
export type AiStreamEvent =
  | AiRunProgressEvent
  | ({ type: "queue" } & AiQueueSnapshot)
  | { type: "thread_updated"; threadId: number };
