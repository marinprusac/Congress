import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// The Gmail connector's cache: one row per thread (kept, never windowed),
// its addresses, per-account cursors, and settings.

export const accounts = sqliteTable("accounts", {
  accountId: integer("account_id").primaryKey(),
  // Gmail history cursor; null until the first backfill finished.
  historyId: text("history_id"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
});

export const threads = sqliteTable(
  "threads",
  {
    // <accountId>:<threadId>, the source key.
    key: text("key").primaryKey(),
    accountId: integer("account_id").notNull(),
    threadId: text("thread_id").notNull(),
    subject: text("subject").notNull(),
    // Sender of the latest message.
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    lastAt: integer("last_at").notNull(),
    snippet: text("snippet").notNull().default(""),
    messageCount: integer("message_count").notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull(),
    inbox: integer("inbox", { mode: "boolean" }).notNull(),
    // Union of the messages' Gmail labels (JSON array).
    labelIds: text("label_ids").notNull().default("[]"),
    hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
    // Message ids seen, to tell newly received mail (JSON array).
    messageIds: text("message_ids").notNull().default("[]"),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("threads_last_at_idx").on(t.lastAt), index("threads_account_idx").on(t.accountId)]
);

export const threadAddresses = sqliteTable(
  "thread_addresses",
  {
    threadKey: text("thread_key").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    // In the To of a message the owner sent: direct contact.
    sentTo: integer("sent_to", { mode: "boolean" }).notNull().default(false),
    personId: text("person_id"),
  },
  (t) => [primaryKey({ columns: [t.threadKey, t.email] })]
);

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
