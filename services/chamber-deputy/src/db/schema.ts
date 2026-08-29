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
  // Own schedule, separate from the free-text body (still not structurally
  // parsed - see the comment above): null means this directive only ever
  // runs on demand (play button) or as part of a chat bundle, never on its
  // own timer. checkup.ts arms a single self-rescheduling timer for
  // whichever enabled+scheduled directive's (lastRunAt + intervalMs) is
  // soonest - the same "one timer for the soonest deadline" idiom
  // chamber-tasks uses for due-date checks, just per-directive here instead
  // of per-task.
  intervalMs: integer("interval_ms"),
  // Stamped the moment a scheduled or manual run for this directive is
  // kicked off (not when it finishes) - see checkup.ts/directives.ts -
  // so a slow `claude` invocation can't cause the next tick to re-fire the
  // same directive before the first run lands.
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
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

// Just enough to enforce settings.budgetCapUsd (engine.ts's runDeputy checks
// todaySpendUsd before spawning another `claude` process) - no transcript,
// prompt, or response text. Full context for a completed run is published
// live to Congress's event relay instead (events.ts's deputy.directive_run)
// for the Logs Chamber to durably keep if the owner sets up a rule; Deputy
// itself keeps no run history of its own.
export const deputySpend = sqliteTable(
  "deputy_spend",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    costUsd: real("cost_usd"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("deputy_spend_created_at_idx").on(table.createdAt)]
);

// Single-row table (id is always 1) - unlike most Chambers' placeholder
// settings row, Deputy has real owner-tunable knobs from day one (see
// docs/deputy-chamber-plan.md §12): background context, chat behavior, the
// budget cap, model choice, retention, and the pause/kill switch. Scheduling
// is no longer a single global knob here - see directives.ts's own
// intervalMs, one per directive.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  contextPrompt: text("context_prompt").notNull().default(""),
  chatIdleWindowMs: integer("chat_idle_window_ms").notNull().default(30 * 60 * 1000),
  budgetCapUsd: real("budget_cap_usd").notNull().default(10),
  model: text("model").notNull().default("claude-sonnet-5"),
  retentionDays: integer("retention_days").notNull().default(30),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  pausedReason: text("paused_reason"),
});

// This Chamber's own short-lived buffer of events received since a
// directive last ran (see checkup.ts) - deliberately separate from
// `settings` above (owner-facing). Congress no longer keeps a replayable
// log of its own (see services/congress/src/events.ts), so a Chamber that
// wants to fold "everything since last time" into a directive's prompt has
// to persist that itself instead of re-polling a cursor against Congress's
// own storage. Drained (read + deleted) in one step every time any
// directive's own scheduled tick actually fires (eventReceive.ts's
// handleReceivedEvent inserts, checkup.ts's tick drains).
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
