import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// One row per event type any registered Chamber declares in its own
// manifest (manifest.events, shared-types) - auto-populated and kept
// current by eventCatalogSync.ts, never user-created or user-deleted.
// `chamber`/`label`/`description` are a display-only cache of that
// Chamber's own declared catalog entry, refreshed on every sync; everything
// else is the owner's own configuration for what to do when this event type
// fires (eventReceive.ts): record to this Chamber's own durable history
// and/or push a notification, independently, either or both. A row with
// both actions off is simply a known-but-inert event type, same as no
// matching row ever existed.
export const eventSettings = sqliteTable(
  "event_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventType: text("event_type").notNull().unique(),
    chamber: text("chamber").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    // JSON-serialized ManifestEventField map (shared-types), same
    // display-only cache treatment as label/description above - refreshed
    // from that event type's own manifest entry on every sync, never
    // user-edited. Lets the notify-template inputs below offer known
    // {{payload.x}} paths instead of requiring the owner to already know the
    // shape. Null for an event type whose publisher declared no fields.
    payloadFieldsJson: text("payload_fields_json"),
    recordToHistory: integer("record_to_history", { mode: "boolean" }).notNull().default(true),
    // How long a history row this event type writes sticks around before
    // being pruned. Null means "use eventHistory.ts's own
    // DEFAULT_HISTORY_RETENTION_MS" - deliberately not a single global
    // constant like Congress's own (short-lived) event switch, since a
    // durable record is exactly the thing Congress's own log isn't meant to
    // be.
    historyRetentionMs: integer("history_retention_ms"),
    notify: integer("notify", { mode: "boolean" }).notNull().default(false),
    // {{payload.x}} interpolated against the firing event's payload (see
    // eventReceive.ts's interpolate()); unset falls back to the cached
    // label/description above.
    notifyTitleTemplate: text("notify_title_template"),
    notifyBodyTemplate: text("notify_body_template"),
    notifyUrlTemplate: text("notify_url_template"),
    // Needed to upsert without duplicating a notification on every re-fire
    // of the same still-true condition, see notifications.ts's
    // pushNotification. Unset falls back to a fixed per-event-type key
    // (eventReceive.ts) - an owner who wants per-entity notifications (e.g.
    // one per overdue task) templates this explicitly.
    notifyDedupeKeyTemplate: text("notify_dedupe_key_template"),
    lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("event_settings_chamber_idx").on(table.chamber)]
);

// The durable record a "recordToHistory" event type writes to - genuinely
// append-only, unlike `notifications` below: every matching firing gets its
// own row, including repeats of a still-true condition, since a history is
// meant to show what actually happened over time, not just current state.
// `expiresAt` is computed once at record time from the recording event
// type's own `historyRetentionMs` (or eventHistory.ts's default), same
// pattern as Congress's own events.expiresAt. `type` is enough to join back
// to `eventSettings` for display (one row per event type, no separate rule
// id needed).
export const eventHistory = sqliteTable(
  "event_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chamber: text("chamber").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("event_history_type_idx").on(table.type),
    index("event_history_occurred_at_idx").on(table.occurredAt),
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
    // listNotifications()'s unreadCount is a `WHERE read_at IS NULL` count
    // on every call - without an index, that's a full table scan.
    index("notifications_read_at_idx").on(table.readAt),
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
