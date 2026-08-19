import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
// per-user or per-Chamber. Chamber-local preferences (e.g. Capitol's own
// "hidden widgets" list) live in that Chamber's own settings table instead -
// this one only holds what has to survive Capitol not being registered.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  darkMode: integer("dark_mode", { mode: "boolean" }).notNull().default(false),
});
