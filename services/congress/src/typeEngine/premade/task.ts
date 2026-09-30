import type { Premade } from "./index.js";

// Replaces the Tasks Chamber: a due day, completion with its time, and the
// due_soon -> overdue -> due_cleared ladder it used to fire from its own timer.
export const TASK: Premade = {
  key: "task",
  batches: [
    [
      { op: "create_type", slug: "task", label: "Task", pluralLabel: "Tasks", icon: "task" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "due", label: "Due", kind: "date", options: { indexed: true } },
      { op: "add_field", slug: "completed", label: "Completed", kind: "boolean" },
      { op: "add_field", slug: "completed_at", label: "Completed at", kind: "datetime", options: { readonly: true } },
      { op: "add_field", slug: "description", label: "Description", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "description" },
      {
        op: "set_actions",
        actions: [
          { kind: "toggle", field: "completed", on: "Reopen", off: "Complete", onEvent: "completed", offEvent: "reopened", stampField: "completed_at" },
        ],
      },
      {
        op: "set_feed_rules",
        rules: [
          { when: { op: "overdue", field: "due" }, and: [{ field: "completed", value: false }], score: 90, reason: "Overdue", preview: ["due", "description"] },
          { when: { op: "within_next", field: "due", hours: 48 }, and: [{ field: "completed", value: false }], score: 85, preview: ["due", "description"] },
        ],
      },
      {
        op: "set_time_triggers",
        triggers: [
          {
            field: "due",
            anchor: "end_of_day",
            and: [{ field: "completed", value: false }],
            steps: [
              { event: "due_soon", label: "Task due soon", offsetMinutes: -24 * 60 },
              { event: "overdue", label: "Task overdue", offsetMinutes: 0 },
            ],
            clearEvent: { event: "due_cleared", label: "Task no longer due" },
          },
        ],
      },
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: visible once the Tasks Chamber's data is imported.
    [{ op: "set_type_meta", hidden: false }],
  ],
};
