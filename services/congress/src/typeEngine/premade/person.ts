import type { Premade } from "./index.js";

// People: what mail senders, chats and calendar guests link to. Only direct contact creates one (lookupOrCreate).
export const PERSON: Premade = {
  key: "person",
  batches: [
    [
      { op: "create_type", slug: "person", label: "Person", pluralLabel: "People", icon: "person" },
      { op: "add_field", slug: "name", label: "Name", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "name" },
      { op: "add_field", slug: "emails", label: "Emails", kind: "text", options: { key: "email", searchable: true } },
      { op: "add_field", slug: "phones", label: "Phones", kind: "text", options: { key: "phone", searchable: true } },
      { op: "add_field", slug: "birthday", label: "Birthday", kind: "date" },
      { op: "add_field", slug: "notes", label: "Notes", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "notes" },
      { op: "set_type_meta", autoCreate: "corresponded" },
    ],
  ],
};
