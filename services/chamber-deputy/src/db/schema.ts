import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// A directive: Deputy's mandate, handed to it as context on every headless
// invocation (see promptAssembly.ts) - deliberately thinner than
// Automation's `automations` table (no triggerEventType/condition/action).
// Automation Chamber needs that structure because its executor is dumb code
// matching an event type to a fixed call; Deputy's executor is Claude
// itself, so a directive is just plain-English instruction text - a
// directive can be purely time-based ("every morning, do X") or
// event-reactive ("if a flight starts within 24h, remind me") in the same
// free-text body, because nothing downstream parses it structurally. Title
// and body are this row's Exhibit surface (searchable, [[wikilink]]-able,
// referenceable from notes) via createTableBackedExhibits in exhibits.ts.
export const directives = sqliteTable("directives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Explicit references added from a directive's "References" side panel,
// kept separate from the wikilinks parsed out of `directives.body` - see
// extractOutgoingExhibitRefs/syncDirectiveExhibit in directives.ts, which
// unions both into the set actually pushed to Congress. Same shape as every
// other Chamber's own "<entity>Refs" table.
export const directiveRefs = sqliteTable(
  "directive_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    directiveId: integer("directive_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("directive_refs_directive_target_idx").on(table.directiveId, table.targetExhibitId)]
);

// Chat log: functional command traffic, not reference material - deliberately
// not an Exhibit (see docs/deputy-chamber-plan.md §9). `sessionId` is the
// `claude` CLI's own session id (see engine.ts) - messages sharing one are
// one resumed conversation; a gap of more than the configured idle window
// starts a fresh id, see chat.ts's session-resolution logic.
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("messages_session_id_idx").on(table.sessionId), index("messages_created_at_idx").on(table.createdAt)]
);

// One row per headless `claude` invocation (chat reply, periodic checkup, or
// urgent fast path) - the audit log the whole "call every tool with
// --dangerously-skip-permissions" design leans on for visibility (see
// docs/deputy-chamber-plan.md §11). `transcriptJson` is an array of
// DeputyTranscriptEntry (types.ts), parsed out of the CLI's own
// --output-format stream-json - see engine.ts's spawnClaude.
export const deputyRuns = sqliteTable(
  "deputy_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trigger: text("trigger", { enum: ["chat", "periodic", "urgent"] }).notNull(),
    sessionId: text("session_id"),
    prompt: text("prompt").notNull(),
    transcriptJson: text("transcript_json").notNull().default("[]"),
    finalResponse: text("final_response"),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("deputy_runs_created_at_idx").on(table.createdAt), index("deputy_runs_trigger_idx").on(table.trigger)]
);

// Single-row table (id is always 1) - unlike most Chambers' placeholder
// settings row, Deputy has real owner-tunable knobs from day one (see
// docs/deputy-chamber-plan.md §12): persona/tone, scheduling, the budget
// cap, model choice, retention, and the pause/kill switch.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  personaPrompt: text("persona_prompt").notNull().default(""),
  checkupIntervalMs: integer("checkup_interval_ms").notNull().default(20 * 60 * 1000),
  chatIdleWindowMs: integer("chat_idle_window_ms").notNull().default(30 * 60 * 1000),
  budgetCapUsd: real("budget_cap_usd").notNull().default(10),
  model: text("model").notNull().default("claude-sonnet-5"),
  retentionDays: integer("retention_days").notNull().default(30),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  pausedReason: text("paused_reason"),
});

// This Chamber's own short-lived buffer of events received since the last
// periodic checkup (see checkup.ts) - deliberately separate from `settings`
// above (owner-facing). Congress no longer keeps a replayable log of its
// own (see services/congress/src/events.ts), so a Chamber that wants to
// fold "everything since last time" into a periodic prompt has to persist
// that itself instead of re-polling a cursor against Congress's own
// storage. Drained (read + deleted) in one step every time a periodic
// checkup actually runs (eventReceive.ts's handleReceivedEvent inserts,
// checkup.ts's runPeriodicCheckup drains) - an urgent event both lands here
// *and* separately preempts an immediate run, same two-track behavior the
// old poller's lastUrgentEventId/lastCheckupEventId split gave it.
export const pendingCheckupEvents = sqliteTable(
  "pending_checkup_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chamber: text("chamber").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("pending_checkup_events_occurred_at_idx").on(table.occurredAt)]
);
