import type { Premade } from "./index.js";

// Replaces the Notes Chamber.
export const NOTE: Premade = {
  key: "note",
  batches: [
    [
      { op: "create_type", slug: "note", label: "Note", pluralLabel: "Notes", icon: "note" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "body", label: "Body", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "body" },
      { op: "add_field", slug: "pinned", label: "Pinned", kind: "boolean" },
      { op: "set_actions", actions: [{ kind: "toggle", field: "pinned", on: "Unpin", off: "Pin" }] },
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: visible once the Notes Chamber's data is imported.
    [{ op: "set_type_meta", hidden: false }],
  ],
};
