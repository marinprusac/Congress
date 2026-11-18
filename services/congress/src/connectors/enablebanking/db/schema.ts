import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// The Enable Banking connector's cache: the app credentials, bank consents
// (sessions), their accounts and booked transactions. Read-only forever.

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  appId: text("app_id"),
  // PEM of the app's private key (Enable Banking never sees it).
  privateKey: text("private_key"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
});

// A consent started but not yet returned from the bank; `state` is the one-time nonce.
export const pendingAuths = sqliteTable("pending_auths", {
  state: text("state").primaryKey(),
  bank: text("bank").notNull(),
  country: text("country").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const connections = sqliteTable("connections", {
  sessionId: text("session_id").primaryKey(),
  bank: text("bank").notNull(),
  country: text("country").notNull(),
  validUntil: text("valid_until").notNull(),
  // active | revoked
  status: text("status").notNull().default("active"),
  expiryNotified: integer("expiry_notified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  uid: text("uid").primaryKey(),
  sessionId: text("session_id").notNull(),
  name: text("name").notNull(),
  iban: text("iban"),
  currency: text("currency").notNull(),
  // Latest booking date pulled, so the next sync overlaps from just before it.
  syncedThrough: text("synced_through"),
  // When the bank was last asked (ms), kept across restarts so deploys don't burn its daily read allowance.
  lastFetchedAt: integer("last_fetched_at"),
});

export const transactions = sqliteTable(
  "transactions",
  {
    key: text("key").primaryKey(),
    accountUid: text("account_uid").notNull(),
    bookingDate: text("booking_date").notNull(),
    // Signed: money out is negative.
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    counterparty: text("counterparty").notNull().default(""),
    description: text("description").notNull().default(""),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("transactions_by_date").on(t.bookingDate)]
);
