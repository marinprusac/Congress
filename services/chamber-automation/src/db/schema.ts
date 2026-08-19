import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// An automation: listens for one event type (from Congress's generic event
// log, see eventPoller.ts) and, when it fires and the optional condition
// matches, calls one MCP tool on one target Chamber with interpolated
// arguments - real cross-Chamber write access, not just a notification.
// Title and body are this row's Exhibit surface (searchable,
// [[wikilink]]-able, referenceable from notes) via createTableBackedExhibits
// in exhibits.ts; the trigger/condition/action fields are structured
// sidecars edited through their own form, not the body text - same split
// chamber-tasks uses for its own dueDate/completed fields. There's no
// push-a-notification action here at all - if a called tool's effect is
// worth surfacing to the owner, the *called* Chamber publishes its own
// event as an ordinary side effect, and Logs Chamber's own rules decide
// whether that's worth recording/notifying. Automations and notifications
// stay fully decoupled through the event log.
export const automations = sqliteTable(
  "automations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    triggerEventType: text("trigger_event_type").notNull(),
    // Optional single-field-equality filter beyond the event type match -
    // e.g. only fire if payload.taskId == "42". No expression language by
    // design: this is the only condition shape v1 supports.
    conditionField: text("condition_field"),
    conditionEquals: text("condition_equals"),
    targetChamber: text("target_chamber").notNull(),
    toolName: text("tool_name").notNull(),
    // A flat map of argument name -> template string, {{payload.x}}
    // interpolated against the firing event's payload - see
    // eventPoller.ts's callTool(). Each interpolated value is JSON.parsed
    // when that succeeds (so "42"/"true"/"{{payload.obj}}" resolving to an
    // object all come through as their real type), falling back to the raw
    // interpolated string otherwise - no JSON-Schema-aware coercion beyond
    // that, matching every other template field in this system's
    // no-expression-language restraint.
    argsTemplateJson: text("args_template_json").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("automations_trigger_event_type_idx").on(table.triggerEventType)]
);

// Explicit references added from an automation's "References" side panel,
// kept separate from the wikilinks parsed out of `automations.body` - see
// extractOutgoingExhibitRefs/syncAutomationExhibit in automations.ts, which
// unions both into the set actually pushed to Congress. Same shape as every
// other Chamber's own "<entity>Refs" table (see e.g.
// chamber-notes/src/db/schema.ts's noteRefs).
export const automationRefs = sqliteTable(
  "automation_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("automation_refs_automation_target_idx").on(table.automationId, table.targetExhibitId)]
);

// Bounded debug log, not Exhibit content - purely powers the "recent
// activity" panel on an automation's edit page so the owner can see what a
// call actually did (or why it failed) without waiting to notice
// side-effects elsewhere. Pruned by eventPoller.ts on insert (keeps the
// newest N per automation), not on a timer - a poller that's been running a
// while would otherwise grow this unboundedly.
export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    targetChamber: text("target_chamber").notNull(),
    toolName: text("tool_name").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    // Exactly one of these is set, depending on `ok` - the tool's own
    // result content (JSON.stringify'd) on success, or the caught error's
    // message on failure.
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
    firedAt: integer("fired_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("automation_runs_automation_id_idx").on(table.automationId)]
);

// Single-row table (id is always 1) - kept for contract uniformity with
// every other Chamber, even if this one has no settings of its own yet.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});
