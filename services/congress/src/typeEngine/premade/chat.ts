import type { Premade } from "./index.js";

// Replaces the WhatsApp Chamber: one record per chat the wa-reader knows.
// Messages stay in the reader (read live); nothing is ever sent to WhatsApp.
export const CHAT: Premade = {
  key: "chat",
  batches: [
    [
      { op: "create_type", slug: "chat", label: "Chat", pluralLabel: "Chats", icon: "chat" },
      { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "name" },
      { op: "add_field", slug: "last_at", label: "Last message", kind: "datetime", options: { indexed: true } },
      { op: "add_field", slug: "preview", label: "Last message text", kind: "text" },
      { op: "add_field", slug: "people", label: "People", kind: "relation", options: { target: "person", many: true } },
      { op: "add_field", slug: "unread", label: "Unread", kind: "number" },
      { op: "add_field", slug: "has_unread", label: "Has unread", kind: "boolean" },
      { op: "add_field", slug: "last_from_me", label: "Last from you", kind: "boolean" },
      { op: "add_field", slug: "group", label: "Group", kind: "boolean" },
      { op: "add_field", slug: "phone", label: "Phone", kind: "text", options: { searchable: true } },
      {
        op: "set_feed_rules",
        rules: [
          {
            when: { op: "within_last", field: "last_at", hours: 24 },
            and: [
              { field: "has_unread", value: true },
              { field: "last_from_me", value: false },
            ],
            score: 50,
            reason: "Unread",
            preview: ["preview"],
          },
        ],
      },
      {
        op: "set_binding",
        binding: {
          connector: "whatsapp",
          kind: "chat",
          label: "WhatsApp",
          fields: [
            { source: "name", target: "name", mode: "pull" },
            { source: "lastAt", target: "last_at", mode: "pull" },
            { source: "preview", target: "preview", mode: "pull" },
            { source: "people", target: "people", mode: "pull" },
            { source: "unread", target: "unread", mode: "pull" },
            { source: "hasUnread", target: "has_unread", mode: "pull" },
            { source: "lastFromMe", target: "last_from_me", mode: "pull" },
            { source: "isGroup", target: "group", mode: "pull" },
            { source: "phone", target: "phone", mode: "pull" },
          ],
          delete: "never",
          // Local only: the reader's own DB; WhatsApp and the sender are never told.
          actions: [{ id: "mark_read", label: "Mark read", act: "markReadLocally", args: {}, when: [{ fact: "hasUnread" }], unless: [] }],
        },
      },
      // Hidden, bound and silent until the WhatsApp Chamber's cutover (phase 7d).
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: in use.
    [{ op: "set_type_meta", hidden: false }],
  ],
};
