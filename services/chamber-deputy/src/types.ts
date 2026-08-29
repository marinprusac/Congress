import { z } from "zod";

// "interval": every intervalMs, anchored off lastRunAt. "daily"/"weekly":
// a wall-clock time of day (scheduleHour/scheduleMinute, read in
// scheduleTimeZone), "weekly" additionally pinned to scheduleDayOfWeek (0
// Sunday - 6 Saturday). "event": fires immediately when triggerEventType is
// received (eventReceive.ts), never off the periodic timer at all. null:
// manual/chat only. See scheduling.ts for the daily/weekly math and
// db/schema.ts for which columns back which type.
export const directiveScheduleTypeSchema = z.enum(["interval", "daily", "weekly", "event"]);
export type DirectiveScheduleType = z.infer<typeof directiveScheduleTypeSchema>;

// Shared by both the summary (server -> client, includes the derived
// nextRunAt) and the create/update requests (client -> server, which don't)
// - one place to keep the "does this scheduleType actually have its
// required companion fields" rule enforced.
function requireScheduleCompanions<T extends { scheduleType?: DirectiveScheduleType | null }>(
  data: T & {
    intervalMs?: number | null;
    scheduleHour?: number | null;
    scheduleMinute?: number | null;
    scheduleDayOfWeek?: number | null;
    scheduleTimeZone?: string | null;
    triggerEventType?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.scheduleType === "interval" && data.intervalMs == null) {
    ctx.addIssue({ code: "custom", message: "intervalMs is required when scheduleType is 'interval'.", path: ["intervalMs"] });
  }
  if (data.scheduleType === "daily" || data.scheduleType === "weekly") {
    if (data.scheduleHour == null) ctx.addIssue({ code: "custom", message: "scheduleHour is required.", path: ["scheduleHour"] });
    if (data.scheduleMinute == null) ctx.addIssue({ code: "custom", message: "scheduleMinute is required.", path: ["scheduleMinute"] });
    if (!data.scheduleTimeZone) ctx.addIssue({ code: "custom", message: "scheduleTimeZone is required.", path: ["scheduleTimeZone"] });
  }
  if (data.scheduleType === "weekly" && data.scheduleDayOfWeek == null) {
    ctx.addIssue({ code: "custom", message: "scheduleDayOfWeek is required when scheduleType is 'weekly'.", path: ["scheduleDayOfWeek"] });
  }
  if (data.scheduleType === "event" && !data.triggerEventType) {
    ctx.addIssue({ code: "custom", message: "triggerEventType is required when scheduleType is 'event'.", path: ["triggerEventType"] });
  }
}

export const directiveSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  scheduleType: directiveScheduleTypeSchema.nullable(),
  intervalMs: z.number().int().positive().nullable(),
  scheduleHour: z.number().int().min(0).max(23).nullable(),
  scheduleMinute: z.number().int().min(0).max(59).nullable(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable(),
  scheduleTimeZone: z.string().nullable(),
  triggerEventType: z.string().nullable(),
  // Derived (scheduling.ts#nextRunAt), not stored - the next timestamp this
  // directive's own timer will fire at, or null for manual-only/"event"
  // (which runs off a received event, not this timer). Powers the list/view
  // pages' schedule display and progress ring; recomputed on every read
  // rather than cached, since it depends on "now" relative to lastRunAt.
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DirectiveSummary = z.infer<typeof directiveSummarySchema>;

export const directiveDetailSchema = directiveSummarySchema;
export type DirectiveDetail = z.infer<typeof directiveDetailSchema>;

// GET /api/directives/running - which directive, if any, currently has a
// `claude` run actually executing (see runningState.ts). Polled by the
// directives list to show a live spinner for a run kicked off anywhere, not
// just this browser tab's own play button.
export const runningDirectiveResponseSchema = z.object({
  directiveId: z.number().int().nullable(),
});
export type RunningDirectiveResponse = z.infer<typeof runningDirectiveResponseSchema>;

export const createDirectiveRequestSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().default(""),
    enabled: z.boolean().default(true),
    scheduleType: directiveScheduleTypeSchema.nullable().default(null),
    intervalMs: z.number().int().positive().nullable().default(null),
    scheduleHour: z.number().int().min(0).max(23).nullable().default(null),
    scheduleMinute: z.number().int().min(0).max(59).nullable().default(null),
    scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
    scheduleTimeZone: z.string().nullable().default(null),
    triggerEventType: z.string().nullable().default(null),
  })
  .superRefine(requireScheduleCompanions);
export type CreateDirectiveRequest = z.infer<typeof createDirectiveRequestSchema>;

// Every schedule field arrives together as one bundle on a real schedule
// change (the ScheduleEditor form always submits its whole draft state, the
// same "PUT the full draft" shape DirectiveViewPage already used for
// intervalMs alone) - so requireScheduleCompanions only runs when
// scheduleType itself is present in this particular request, not on every
// partial update (e.g. a plain enable/disable toggle omits every schedule
// field entirely and must not be rejected for it).
export const updateDirectiveRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    enabled: z.boolean().optional(),
    scheduleType: directiveScheduleTypeSchema.nullable().optional(),
    intervalMs: z.number().int().positive().nullable().optional(),
    scheduleHour: z.number().int().min(0).max(23).nullable().optional(),
    scheduleMinute: z.number().int().min(0).max(59).nullable().optional(),
    scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    scheduleTimeZone: z.string().nullable().optional(),
    triggerEventType: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scheduleType !== undefined) requireScheduleCompanions(data, ctx);
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

// "scheduled" - this directive's own interval/daily/weekly timer came due
// (checkup.ts). "event" - this directive's own triggerEventType was just
// received (eventReceive.ts), running immediately rather than waiting for
// the next periodic checkup. "manual" - the owner hit the play button on
// one directive. "chat" bundles every enabled directive into one prompt
// instead of targeting a single one.
export const deputyRunTriggerSchema = z.enum(["chat", "scheduled", "event", "manual"]);
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
