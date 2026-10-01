import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// The WhatsApp connector's cache: one row per chat the wa-reader knows (the
// messages stay in the reader), and whether People may be created.

export const chats = sqliteTable("chats", {
  jid: text("jid").primaryKey(),
  name: text("name").notNull().default(""),
  isGroup: integer("is_group", { mode: "boolean" }).notNull(),
  lastAt: integer("last_at").notNull(),
  lastText: text("last_text").notNull().default(""),
  lastType: text("last_type"),
  lastFromMe: integer("last_from_me", { mode: "boolean" }).notNull().default(false),
  lastSender: text("last_sender"),
  lastRevoked: integer("last_revoked", { mode: "boolean" }).notNull().default(false),
  unreadCount: integer("unread_count").notNull().default(0),
  markedUnread: integer("marked_unread", { mode: "boolean" }).notNull().default(false),
  // The phone's mute: 0 none, -1 forever, else the epoch ms it ends; `muted` is that as of the last sync (so an expiry shows as a change).
  mutedUntil: integer("muted_until").notNull().default(0),
  muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  // 1:1 only: the owner's messages among the last 100 (null until counted) - how direct the contact is.
  ownerMessages: integer("owner_messages"),
  personId: text("person_id"),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  // On unless the owner turned it off (Settings → Connectors): 1:1 chats they wrote in create People.
  createPeople: integer("create_people", { mode: "boolean" }).notNull().default(false),
});
