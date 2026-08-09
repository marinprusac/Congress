import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";

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
