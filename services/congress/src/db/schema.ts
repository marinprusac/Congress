import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

export const chambers = sqliteTable("chambers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  version: text("version").notNull(),
  routesJson: text("routes_json").notNull(),
  widgetsJson: text("widgets_json").notNull().default("[]"),
  eventsJson: text("events_json").notNull().default("[]"),
  // This Chamber's current dynamic event interest list (see shared-types/
  // events.ts's chamberSubscriptionSchema), refreshed on every heartbeat -
  // small bounded routing metadata, not an event log, so keeping it here
  // doesn't reopen the "Congress stores no events" decision. Read by
  // events.ts's fan-out to decide who a given publish gets pushed to.
  subscriptionsJson: text("subscriptions_json").notNull().default("[]"),
  apiBase: text("api_base").notNull(),
  mcpUrl: text("mcp_url"),
  healthUrl: text("health_url").notNull(),
  status: text("status", { enum: ["active", "offline", "detached"] }).notNull().default("active"),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }),
  registeredAt: integer("registered_at", { mode: "timestamp_ms" }).notNull(),
});

// Disposable, rebuildable resolution cache - a Chamber pushes here on Exhibit
// create/update/delete (POST /congress/exhibits/sync). Missing/stale rows
// always fall back to a live call to the owning Chamber, never treated as
// authoritative on their own.
export const exhibitCache = sqliteTable("exhibit_cache", {
  id: text("id").primaryKey(),
  chamber: text("chamber").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Backs the undirected "Connections" between two Exhibits - whenever either
// side references the other (body text or a manual add), the two are
// connected, with no differentiation of which side established it. Storage
// is still one directed row per discovery (sourceId "owns" the row) because
// that's what lets a chamber's own sync delete-and-reinsert exactly the
// connections *it* discovered (its own outgoingRefs) without disturbing one
// the other side discovered independently - but this is purely a
// sync-bookkeeping detail. Nothing reads sourceId/targetId as a meaningful
// direction: getConnections (exhibits.ts) collapses both directions into one
// deduped entry per exhibit, and a manual connection is removable from
// either side regardless of which one happens to own the row (see
// getManualConnectionOwner). sourceChamber is stored alongside sourceId so a
// connections lookup doesn't need a second query against exhibitCache just
// to know which Chamber to resolve that side through.
export const exhibitRefs = sqliteTable(
  "exhibit_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id").notNull(),
    sourceChamber: text("source_chamber").notNull(),
    targetId: text("target_id").notNull(),
    // Whether this connection was added explicitly via a Connections-panel
    // "+" (removable from either side) rather than one that can only be
    // re-derived by re-parsing the owning side's own body text.
    isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("exhibit_refs_source_id_idx").on(table.sourceId),
    index("exhibit_refs_target_id_idx").on(table.targetId),
  ]
);

// Single-row table (id is always 1) - one Congress-wide settings scope, not
// per-user or per-Chamber. Chamber-local preferences live in that Chamber's
// own settings table instead.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  darkMode: integer("dark_mode", { mode: "boolean" }).notNull().default(false),
  // Set once legacyImport.ts has copied the retired Capitol/Logs Chambers'
  // own SQLite files into the tables below - see that file.
  legacyImportedAt: integer("legacy_imported_at", { mode: "timestamp_ms" }),
});

// ---- Homepage canvas (formerly the Capitol Chamber) ----

// Where each registered widget sits on Congress's cell-based canvas, one row
// per placed widget per viewport-class scope ("mobile" | "desktop" - see
// components/canvas/ for why exactly two, not one per physical device).
// (scope, chamber, widgetId) is the natural identity, so it's the primary
// key directly rather than a separate surrogate id + unique index - a
// placement is upserted by conflicting on this key. No width/height here:
// those live on the Chamber's own manifest-declared widget, so a Chamber
// changing its declared size later can't leave stale dimensions behind in
// this table. A widget with no row here for a given scope is simply unplaced
// (not shown) - "placed" is the only visibility mechanism now.
export const widgetLayouts = sqliteTable(
  "widget_layouts",
  {
    scope: text("scope", { enum: ["mobile", "desktop"] }).notNull(),
    chamber: text("chamber").notNull(),
    widgetId: text("widget_id").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.chamber, table.widgetId] })]
);

// ---- Event settings, history, notifications, push (formerly the Logs Chamber) ----

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
    // Who performed the action that published this event ("me", "deputy",
    // "automation", "system", ...) - see ACTOR_HEADER in shared-types. Null on
    // rows recorded before this column existed; read back as "system".
    actor: text("actor"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("event_history_type_idx").on(table.type),
    index("event_history_occurred_at_idx").on(table.occurredAt),
    index("event_history_expires_at_idx").on(table.expiresAt),
  ]
);

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
