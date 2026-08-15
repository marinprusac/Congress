import { sqliteTable, text, integer, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const selectedCalendars = sqliteTable(
  "selected_calendars",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    colorHex: text("color_hex"),
    selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    unique("selected_calendars_account_calendar_idx").on(table.accountId, table.googleCalendarId),
    index("selected_calendars_account_id_idx").on(table.accountId),
  ]
);

// Explicit references added from an event's "References" side panel, kept
// separate from the wikilinks parsed out of its description - see
// extractOutgoingExhibitRefs/syncEventExhibit in exhibits.ts/events.ts,
// which union both into the set actually pushed to Capitol. Unlike
// chamber-notes/src/db/schema.ts's noteRefs, keyed directly by the full
// Exhibit id string ("event-1:primary:abc123") rather than a local row id -
// an event has no local row of its own, it's fetched live from Google.
export const eventRefs = sqliteTable(
  "event_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exhibitId: text("exhibit_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("event_refs_exhibit_target_idx").on(table.exhibitId, table.targetExhibitId)]
);
