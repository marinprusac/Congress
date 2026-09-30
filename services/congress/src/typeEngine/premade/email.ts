import type { Premade } from "./index.js";

const primaryUnread = (important: boolean) => [
  { field: "unread", value: true },
  { field: "inbox", value: true },
  { field: "category", value: "primary" },
  { field: "important", value: important },
];

// Replaces the Mail Chamber: one record per Gmail thread, read-only (bodies
// are read live), kept after it leaves the sync window.
export const EMAIL: Premade = {
  key: "email",
  batches: [
    [
      { op: "create_type", slug: "email", label: "Email", pluralLabel: "Emails", icon: "mail" },
      { op: "add_field", slug: "subject", label: "Subject", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "subject" },
      { op: "add_field", slug: "from", label: "From", kind: "text", options: { searchable: true } },
      { op: "add_field", slug: "last_at", label: "Last message", kind: "datetime", options: { indexed: true } },
      { op: "add_field", slug: "people", label: "People", kind: "relation", options: { target: "person", many: true } },
      { op: "add_field", slug: "snippet", label: "Snippet", kind: "text" },
      { op: "add_field", slug: "unread", label: "Unread", kind: "boolean" },
      { op: "add_field", slug: "inbox", label: "In inbox", kind: "boolean" },
      {
        op: "add_field",
        slug: "category",
        label: "Category",
        kind: "enum",
        options: {
          options: [
            { value: "primary", label: "Primary" },
            { value: "promotions", label: "Promotions" },
            { value: "social", label: "Social" },
            { value: "updates", label: "Updates" },
            { value: "forums", label: "Forums" },
          ],
        },
      },
      { op: "add_field", slug: "starred", label: "Starred", kind: "boolean" },
      { op: "add_field", slug: "important", label: "Important", kind: "boolean" },
      { op: "add_field", slug: "messages", label: "Messages", kind: "number" },
      { op: "add_field", slug: "account", label: "Account", kind: "text" },
      {
        op: "set_feed_rules",
        rules: [
          { when: { op: "within_last", field: "last_at", hours: 24 }, and: primaryUnread(true), score: 75, reason: "Important mail", preview: ["from", "snippet"] },
          { when: { op: "within_last", field: "last_at", hours: 24 }, and: primaryUnread(false), score: 55, reason: "New mail", preview: ["from", "snippet"] },
        ],
      },
      {
        op: "set_binding",
        binding: {
          connector: "gmail",
          kind: "thread",
          label: "Gmail",
          fields: [
            { source: "subject", target: "subject", mode: "pull" },
            { source: "from", target: "from", mode: "pull" },
            { source: "lastAt", target: "last_at", mode: "pull" },
            { source: "people", target: "people", mode: "pull" },
            { source: "snippet", target: "snippet", mode: "pull" },
            { source: "unread", target: "unread", mode: "pull" },
            { source: "inbox", target: "inbox", mode: "pull" },
            { source: "category", target: "category", mode: "pull" },
            { source: "starred", target: "starred", mode: "pull" },
            { source: "important", target: "important", mode: "pull" },
            { source: "messageCount", target: "messages", mode: "pull" },
            { source: "account", target: "account", mode: "pull" },
          ],
          delete: "never",
          actions: [{ id: "mark_read", label: "Mark read", act: "markRead", args: {}, when: [{ fact: "canMarkRead" }], unless: [] }],
        },
      },
      // Hidden, bound and silent until the Mail Chamber's cutover (phase 7a).
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: in use.
    [{ op: "set_type_meta", hidden: false }],
  ],
};
