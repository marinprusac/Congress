import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

export const chambers = sqliteTable("chambers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  version: text("version").notNull(),
  routesJson: text("routes_json").notNull(),
  viewsJson: text("views_json").notNull().default("[]"),
  exhibitTypesJson: text("exhibit_types_json").notNull().default("[]"),
  eventsJson: text("events_json").notNull().default("[]"),
  // The Chamber's event interest list when it was loaded (informational;
  // events.ts reads the module's subscriptions() live).
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
  // The home screen's pinned "stories" row, in display order.
  pinnedViews: text("pinned_views", { mode: "json" }).$type<{ chamber: string; viewId: string }[]>().notNull().default([]),
  // Set once legacyImport.ts has copied the retired Capitol/Logs Chambers'
  // own SQLite files into the tables below - see that file.
  legacyImportedAt: integer("legacy_imported_at", { mode: "timestamp_ms" }),
  // Set once Deputy's directives were imported as tracked items.
  directivesImportedAt: integer("directives_imported_at", { mode: "timestamp_ms" }),
});

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

// ---- AI (formerly Deputy's engine + chat) ----

// Single-row table (id is always 1), kept apart from `settings` above so the
// /congress/settings contract (dark mode) stays untouched. Shared by the
// owner's chat and every Chamber's remote runs - one budget, one pause
// switch. See ai/settings.ts.
export const aiSettings = sqliteTable("ai_settings", {
  id: integer("id").primaryKey().default(1),
  contextPrompt: text("context_prompt").notNull().default(""),
  budgetCapUsd: real("budget_cap_usd").notNull().default(10),
  model: text("model").notNull().default("claude-sonnet-5"),
  retentionDays: integer("retention_days").notNull().default(30),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  pausedReason: text("paused_reason"),
  maxPushesPerDay: integer("max_pushes_per_day").notNull().default(3),
  // Local hours [start, end) when asks never push; null = no quiet hours.
  quietHoursStart: integer("quiet_hours_start").default(22),
  quietHoursEnd: integer("quiet_hours_end").default(7),
  // IANA zone for quiet hours and the daily push count; null = server zone.
  timeZone: text("time_zone"),
  proactiveEnabled: integer("proactive_enabled", { mode: "boolean" }).notNull().default(true),
  proactiveBudgetUsd: real("proactive_budget_usd").notNull().default(2),
  gateModel: text("gate_model").notNull().default("claude-haiku-4-5-20251001"),
  gateSensitivity: text("gate_sensitivity", { enum: ["low", "normal", "high"] }).notNull().default("normal"),
  heartbeatHours: real("heartbeat_hours").notNull().default(4),
});

// One conversation. sessionId is the `claude` CLI session every run in it
// --resumes; pendingRunId is set while a run for it is queued or running.
export const aiThreads = sqliteTable(
  "ai_threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title"),
    origin: text("origin", { enum: ["owner", "ai"] }).notNull().default("owner"),
    trackingId: integer("tracking_id"),
    sessionId: text("session_id"),
    pendingRunId: text("pending_run_id"),
    pinnedAt: integer("pinned_at", { mode: "timestamp_ms" }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_threads_last_message_at_idx").on(table.lastMessageAt)]
);

// A thread's rows, in order. Asks (message/question/proposal) are rows too,
// so a thread renders as one list; askState/payload only apply to them.
export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    kind: text("kind", { enum: ["text", "message", "question", "proposal", "answer", "decision", "notice"] })
      .notNull()
      .default("text"),
    status: text("status", { enum: ["ok", "error", "refused", "cancelled"] }).notNull().default("ok"),
    text: text("text").notNull(),
    runId: text("run_id"),
    payloadJson: text("payload_json"),
    askState: text("ask_state", {
      enum: ["open", "answered", "expired", "withdrawn", "approved", "rejected", "executed", "failed"],
    }),
    urgency: text("urgency", { enum: ["quiet", "push"] }),
    deliverAt: integer("deliver_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    // When a (possibly delayed) ask actually reached the owner, and pushed.
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    pushedAt: integer("pushed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("ai_messages_thread_id_idx").on(table.threadId, table.id),
    index("ai_messages_created_at_idx").on(table.createdAt),
    index("ai_messages_ask_state_idx").on(table.askState),
  ]
);

// One row per AI run of any kind - the audit trail behind "Why?" and
// Settings → AI → Activity. activityJson is the ordered notes + tool calls.
export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    threadId: integer("thread_id"),
    kind: text("kind").notNull(),
    trigger: text("trigger"),
    actor: text("actor").notNull(),
    model: text("model"),
    status: text("status", { enum: ["running", "ok", "error", "refused", "cancelled"] }).notNull(),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    costUsd: real("cost_usd"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    activityJson: text("activity_json"),
    verdictJson: text("verdict_json"),
  },
  (table) => [index("ai_runs_started_at_idx").on(table.startedAt), index("ai_runs_thread_id_idx").on(table.threadId)]
);

// Things the AI was asked to keep an eye on, each with its own next check.
// recurrence advances nextCheckAt in code, so a check can't be forgotten.
export const aiTracking = sqliteTable(
  "ai_tracking",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status", { enum: ["active", "paused", "done", "dropped"] }).notNull().default("active"),
    watchEventsJson: text("watch_events_json").notNull().default("[]"),
    nextCheckAt: integer("next_check_at", { mode: "timestamp_ms" }),
    recurrenceJson: text("recurrence_json"),
    refsJson: text("refs_json").notNull().default("[]"),
    threadId: integer("thread_id"),
    source: text("source", { enum: ["chat", "ai", "directive", "owner"] }).notNull().default("ai"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_tracking_next_check_at_idx").on(table.nextCheckAt)]
);

// Recent events for the gate's digest (what happened since it last looked).
export const aiEventBuffer = sqliteTable(
  "ai_event_buffer",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chamber: text("chamber").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json"),
    actor: text("actor"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_event_buffer_occurred_at_idx").on(table.occurredAt)]
);

// Plain facts about the owner, carried into every run's prompt.
export const aiFacts = sqliteTable("ai_facts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  source: text("source", { enum: ["ai", "owner"] }).notNull().default("ai"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// One row per `claude` invocation, cost only - just enough to enforce
// aiSettings.budgetCapUsd. `actor` records who asked (congress for chat,
// the calling Chamber otherwise).
export const aiSpend = sqliteTable(
  "ai_spend",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    costUsd: real("cost_usd"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_spend_created_at_idx").on(table.createdAt)]
);

// Google connector accounts, shared by every Chamber that talks to Google
// (connectors/google). `scope` is Google's space-separated granted list.
export const googleAccounts = sqliteTable("google_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  email: text("email").notNull(),
  googleSub: text("google_sub").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope").notNull(),
  tokenExpiry: integer("token_expiry", { mode: "timestamp_ms" }).notNull(),
  needsReconnect: integer("needs_reconnect", { mode: "boolean" }).notNull().default(false),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
