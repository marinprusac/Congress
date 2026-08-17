import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const chambers = sqliteTable("chambers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  version: text("version").notNull(),
  routesJson: text("routes_json").notNull(),
  widgetsJson: text("widgets_json").notNull().default("[]"),
  eventsJson: text("events_json").notNull().default("[]"),
  apiBase: text("api_base").notNull(),
  mcpUrl: text("mcp_url"),
  healthUrl: text("health_url").notNull(),
  contentFormat: text("content_format", { enum: ["markdown", "plain"] }),
  status: text("status", { enum: ["active", "offline"] }).notNull().default("active"),
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

// Reverse index of outgoing references, for backlinks. sourceChamber is
// stored alongside sourceId so a backlink lookup doesn't need a second query
// against exhibitCache just to know which Chamber to resolve the source
// through.
export const exhibitRefs = sqliteTable(
  "exhibit_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id").notNull(),
    sourceChamber: text("source_chamber").notNull(),
    targetId: text("target_id").notNull(),
    // Whether the source Chamber considers this ref one it added explicitly
    // via a References-panel "+" (removable from either side) rather than
    // one it can only re-derive by re-parsing its own body text.
    isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("exhibit_refs_source_id_idx").on(table.sourceId),
    index("exhibit_refs_target_id_idx").on(table.targetId),
  ]
);

// A grant of view/edit access to one exhibit's closure (itself plus
// recursively-referenced exhibits, up to maxDepth) to a holder of `id` as a
// bearer token. One row per recipient - sharing the same root with two
// people is two independently-revocable rows.
export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull(),
  rootChamber: text("root_chamber").notNull(),
  maxDepth: integer("max_depth").notNull(),
  permission: text("permission", { enum: ["view", "edit"] }).notNull(),
  label: text("label").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  lastAccessedAt: integer("last_accessed_at", { mode: "timestamp_ms" }),
});

// Generic, chamber-agnostic append-only event log - any Chamber can publish
// (POST /congress/events/publish) or poll for new entries since a cursor
// (GET /congress/events?since=). Congress never inspects `type`/`payload`
// or relays to a specific chamber by name - it's purely a store+fan-out,
// same spirit as exhibit_cache. `expiresAt` is computed once at publish
// time (see events.ts's publishEvent) from the publishing chamber's own
// declared retentionMs for that event type (manifestEventSchema), falling
// back to a short default - copied onto the row rather than recomputed at
// prune time so a chamber changing its declared retention later doesn't
// retroactively change already-published rows. This is a switch, not a
// durable record - a personal single-user system doesn't need unbounded
// retention of already-fired events (that's Logs Chamber's own
// event_history table's job).
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chamber: text("chamber").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("events_occurred_at_idx").on(table.occurredAt), index("events_expires_at_idx").on(table.expiresAt)]
);

// Single-row table (id is always 1) - one Congress-wide settings scope, not
// per-user or per-Chamber. Chamber-local preferences (e.g. Capitol's own
// "hidden widgets" list) live in that Chamber's own settings table instead -
// this one only holds what has to survive Capitol not being registered.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  darkMode: integer("dark_mode", { mode: "boolean" }).notNull().default(false),
});
