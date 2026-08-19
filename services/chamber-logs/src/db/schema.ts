import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { PRIORITY_LEVELS } from "@congress/shared-types";

// A log rule: listens for one event type (from Congress's generic event
// log, see eventPoller.ts) and, when it fires and the optional condition
// and minPriority threshold both match, records it to this Chamber's own
// durable history and/or pushes a notification - independently, either or
// both. No matching rule (or a rule that does neither) means the event is
// simply discarded, same as Congress's own log treats anything unconsumed.
// Title and body are this row's Exhibit surface (searchable,
// [[wikilink]]-able, referenceable from notes) via createTableBackedExhibits
// in exhibits.ts; the trigger/condition/action fields are structured
// sidecars edited through their own form, not the body text - same split
// chamber-tasks uses for its own dueDate/completed fields.
export const logRules = sqliteTable(
  "log_rules",
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
    // Ordered low < normal < high < urgent (PRIORITY_LEVELS, shared-types) -
    // null means no threshold, every firing matches regardless of the
    // event's own declared payload.priority. ">=" is deliberately the only
    // comparison this supports (see eventPoller.ts's minPriorityMatches) -
    // same no-expression-language restraint as conditionField/
    // conditionEquals, just for an ordered field instead of an arbitrary
    // one.
    minPriority: text("min_priority", { enum: PRIORITY_LEVELS }),
    recordToHistory: integer("record_to_history", { mode: "boolean" }).notNull().default(true),
    // Per-rule, not global - how long a history row this rule writes sticks
    // around before being pruned. Null means "use eventHistory.ts's own
    // DEFAULT_HISTORY_RETENTION_MS" - deliberately not a single global
    // constant like Congress's own (short-lived) event switch, since a
    // durable record is exactly the thing Congress's own log isn't meant to
    // be.
    historyRetentionMs: integer("history_retention_ms"),
    notify: integer("notify", { mode: "boolean" }).notNull().default(false),
    // Required when notify is true (enforced at the request-schema level,
    // not here) - {{payload.x}} interpolated against the firing event's
    // payload, see eventPoller.ts's interpolate().
    notifyTitleTemplate: text("notify_title_template"),
    notifyBodyTemplate: text("notify_body_template"),
    notifyUrlTemplate: text("notify_url_template"),
    // Also required when notify is true - needed to upsert without
    // duplicating a notification on every re-fire of the same still-true
    // condition, see notifications.ts's pushNotification. Unlike
    // recordToHistory, notify always dedupes: an inbox is meant to show
    // current state, not a growing feed of repeats the way history is.
    notifyDedupeKeyTemplate: text("notify_dedupe_key_template"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("log_rules_trigger_event_type_idx").on(table.triggerEventType)]
);

// Explicit references added from a log rule's "References" side panel, kept
// separate from the wikilinks parsed out of `logRules.body` - see
// extractOutgoingExhibitRefs/syncLogRuleExhibit in logRules.ts, which unions
// both into the set actually pushed to Capitol. Same shape as every other
// Chamber's own "<entity>Refs" table (see e.g. chamber-notes/src/db/
// schema.ts's noteRefs).
export const logRuleRefs = sqliteTable(
  "log_rule_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    logRuleId: integer("log_rule_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("log_rule_refs_rule_target_idx").on(table.logRuleId, table.targetExhibitId)]
);

// The durable record a "recordToHistory" rule writes to - genuinely
// append-only, unlike `notifications` below: every matching firing gets its
// own row, including repeats of a still-true condition, since a history is
// meant to show what actually happened over time, not just current state.
// `priority` is copied from the firing event's own payload at record time
// (defaulting to "normal" when the publishing Chamber didn't set one) so
// the "urgent-logs" widget can filter on it without re-parsing
// `payloadJson` per query. `expiresAt` is computed once at record time from
// the recording rule's own `historyRetentionMs` (or eventHistory.ts's
// default), same pattern as Congress's own events.expiresAt.
export const eventHistory = sqliteTable(
  "event_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: integer("rule_id").notNull(),
    chamber: text("chamber").notNull(),
    type: text("type").notNull(),
    // An index into PRIORITY_LEVELS (shared-types), not the text label -
    // "high" >= "low" doesn't sort correctly as a string (alphabetically
    // "high" < "low"), and the "urgent-logs" widget needs a real >= query
    // (see eventHistory.ts's listHistory), not an app-level filter over
    // every row. priorityRankFor()/priorityLevelFor() (eventHistory.ts)
    // convert to/from the string label at the boundary.
    priorityRank: integer("priority_rank").notNull().default(1),
    payloadJson: text("payload_json").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("event_history_occurred_at_idx").on(table.occurredAt),
    index("event_history_priority_rank_idx").on(table.priorityRank),
    index("event_history_expires_at_idx").on(table.expiresAt),
  ]
);

// Single-row table (id is always 1) - kept for contract uniformity with
// every other Chamber, even if this one has no settings of its own yet.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});

// This Chamber's own notification center - formerly Congress-owned
// (services/congress/src/db/schema.ts), moved here so Congress has no
// notification-specific product surface at all. One row per (chamber,
// dedupeKey): re-pushing the same key upserts in place (see
// notifications.ts's pushNotification), so a poller can call this on every
// tick while a condition still holds without spamming duplicates. Dismissing
// a notification deletes its row outright rather than soft-deleting - if
// the underlying condition still holds, the next push simply recreates it.
// Unlike eventHistory below, this is live current state, not an append-only
// record - that's the whole reason the two need different dedupe semantics.
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chamber: text("chamber").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    chamberUrl: text("chamber_url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("notifications_chamber_dedupe_key_idx").on(table.chamber, table.dedupeKey),
    index("notifications_created_at_idx").on(table.createdAt),
  ]
);

// One row per subscribed browser/device (phone, laptop, ...) - a single-user
// system still has multiple devices, so this is a plain list, not a
// single-row table. `endpoint` is the push service's own per-subscription
// URL (unique per browser+device by construction), used as the natural
// dedupe key when the same device re-subscribes. See pushSubscriptions.ts's
// sendWebPush for how a row here gets pruned once its endpoint starts
// coming back expired.
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
