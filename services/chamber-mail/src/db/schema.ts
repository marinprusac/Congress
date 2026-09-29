import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// A disposable mirror of recent Gmail message headers - Gmail stays the
// source of truth. Backs the feed, exhibit search and quick listings.
// `id` is "<accountId>:<gmailMessageId>".
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    accountId: integer("account_id").notNull(),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id").notNull(),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    to: text("to"),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    internalDate: integer("internal_date", { mode: "timestamp_ms" }).notNull(),
    // JSON array of Gmail label ids.
    labelIds: text("label_ids").notNull().default("[]"),
    unread: integer("unread", { mode: "boolean" }).notNull(),
    inInbox: integer("in_inbox", { mode: "boolean" }).notNull(),
    hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("messages_account_thread_idx").on(table.accountId, table.threadId),
    index("messages_internal_date_idx").on(table.internalDate),
  ]
);

// Per-account Gmail sync cursor (history.list startHistoryId).
export const syncState = sqliteTable("sync_state", {
  accountId: integer("account_id").primaryKey(),
  historyId: text("history_id"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
});

// Manual Connections-panel refs, keyed by the thread's exhibit id.
export const threadRefs = sqliteTable(
  "thread_refs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exhibitId: text("exhibit_id").notNull(),
    targetExhibitId: text("target_exhibit_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("thread_refs_exhibit_target_idx").on(table.exhibitId, table.targetExhibitId)]
);

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // Promotions/Social/Updates/Forums too, not just Primary, in the feed and mail.received.
  includeAllCategories: integer("include_all_categories", { mode: "boolean" }).notNull().default(false),
  feedWindowHours: integer("feed_window_hours").notNull().default(24),
});
