import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// The Gmail connector keeps no mail: per-account history cursors and settings.

export const accounts = sqliteTable("accounts", {
  accountId: integer("account_id").primaryKey(),
  // Gmail history cursor; null until the first backfill finished.
  historyId: text("history_id"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
});

// Addresses that never become People on their own (the owner said no), only link.
export const peopleSkip = sqliteTable("people_skip", {
  email: text("email").primaryKey(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // Promotions/Social/Updates/Forums too, not just Primary, for mail.received.
  includeAllCategories: integer("include_all_categories", { mode: "boolean" }).notNull().default(false),
  // Off while the Mail Chamber still runs (it publishes mail.received itself).
  publishEvents: integer("publish_events", { mode: "boolean" }).notNull().default(false),
  // Off until the owner saw the dry-run count; then To of sent mail creates People.
  createPeople: integer("create_people", { mode: "boolean" }).notNull().default(false),
});
