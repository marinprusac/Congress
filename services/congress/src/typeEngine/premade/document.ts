import type { Premade } from "./index.js";

// Replaces the Documents Chamber: an uploaded file with a title and notes.
export const DOCUMENT: Premade = {
  key: "document",
  batches: [
    [
      { op: "create_type", slug: "document", label: "Document", pluralLabel: "Documents", icon: "document" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "file", label: "File", kind: "file", options: { required: true } },
      { op: "add_field", slug: "description", label: "Description", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "description" },
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: visible once the Documents Chamber's data is imported.
    [{ op: "set_type_meta", hidden: false }],
  ],
};
