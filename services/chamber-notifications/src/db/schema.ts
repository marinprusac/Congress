import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// An automation: listens for one event type (from Congress's generic event
// log, see eventPoller.ts) and, when it fires and the optional condition
// matches, pushes or withdraws a notification with templated content. Title
// and body are this row's Exhibit surface (searchable, [[wikilink]]-able,
// referenceable from notes) via createTableBackedExhibits in exhibits.ts;
// the trigger/condition/action fields are structured sidecars edited
// through their own form, not the body text - same split chamber-tasks uses
// for its own dueDate/completed fields.
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
    actionKind: text("action_kind", { enum: ["push", "withdraw"] }).notNull().default("push"),
    // {{payload.x}} interpolated against the firing event's payload - see
    // eventPoller.ts's interpolate(). Title is required for a "push" action
    // (enforced at the request-schema level, not here) but the column stays
    // nullable since a "withdraw" action never uses it.
    actionTitleTemplate: text("action_title_template"),
    actionBodyTemplate: text("action_body_template"),
    actionUrlTemplate: text("action_url_template"),
    // Required regardless of actionKind - a "push" needs it to upsert
    // without duplicating on every re-fire, a "withdraw" needs the exact
    // same value to know which existing notification to remove.
    actionDedupeKeyTemplate: text("action_dedupe_key_template").notNull(),
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
// unions both into the set actually pushed to Capitol. Same shape as every
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
// template actually produced without waiting for a real event. Pruned by
// eventPoller.ts on insert (keeps the newest N per automation), not on a
// timer - a poller that's been running a while would otherwise grow this
// unboundedly.
export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id").notNull(),
    eventId: integer("event_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    resultTitle: text("result_title"),
    resultBody: text("result_body"),
    firedAt: integer("fired_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("automation_runs_automation_id_idx").on(table.automationId)]
);

// Single-row table (id is always 1) - kept for contract uniformity with
// every other Chamber, even if this one has no settings of its own yet.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
});

// This Chamber's own bookkeeping for how far it's read Congress's event log
// - deliberately separate from `settings` above (which backs the
// owner-facing Settings page / updateSettingsRequestSchema): this cursor is
// an internal implementation detail of eventPoller.ts, never user-editable.
export const pollerState = sqliteTable("poller_state", {
  id: integer("id").primaryKey().default(1),
  lastEventId: integer("last_event_id").notNull().default(0),
});

// This Chamber's own notification center - formerly Congress-owned
// (services/congress/src/db/schema.ts), moved here so Congress has no
// notification-specific product surface at all. One row per (chamber,
// dedupeKey): re-pushing the same key upserts in place (see
// notifications.ts's pushNotification), so a poller - or, eventually, an
// automation's action - can call this on every tick while a condition still
// holds without spamming duplicates. Dismissing a notification deletes its
// row outright rather than soft-deleting - if the underlying condition
// still holds, the next push simply recreates it.
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
