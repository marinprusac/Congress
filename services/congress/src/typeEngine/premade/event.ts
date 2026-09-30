import type { Premade } from "./index.js";

// Replaces the Calendar Chamber: events bound to Google Calendar (or local
// ones), a private Hide, and Accept/Maybe/Decline on invitations.
export const EVENT: Premade = {
  key: "event",
  batches: [
    [
      { op: "create_type", slug: "event", label: "Event", pluralLabel: "Events", icon: "calendar" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "start", label: "Start", kind: "datetime", options: { required: true, indexed: true } },
      { op: "add_field", slug: "end", label: "End", kind: "datetime", options: { indexed: true } },
      { op: "add_field", slug: "all_day", label: "All day", kind: "boolean" },
      { op: "set_time_range", range: { start: "start", end: "end", allDay: "all_day" } },
      { op: "add_field", slug: "calendar", label: "Calendar", kind: "text" },
      { op: "add_field", slug: "location", label: "Location", kind: "richtext", options: { searchable: true } },
      { op: "add_field", slug: "people", label: "People", kind: "relation", options: { target: "person", many: true } },
      {
        op: "add_field",
        slug: "response",
        label: "Your response",
        kind: "enum",
        options: {
          readonly: true,
          options: [
            { value: "needsAction", label: "Not answered" },
            { value: "accepted", label: "Going" },
            { value: "tentative", label: "Maybe" },
            { value: "declined", label: "Declined" },
          ],
        },
      },
      { op: "add_field", slug: "hidden", label: "Hidden", kind: "boolean" },
      { op: "add_field", slug: "description", label: "Description", kind: "richtext", options: { searchable: true } },
      { op: "set_layout", body: "description" },
      { op: "set_actions", actions: [{ kind: "toggle", field: "hidden", on: "Show", off: "Hide", onEvent: "hidden", offEvent: "shown" }] },
      {
        op: "set_feed_rules",
        rules: [
          {
            when: { op: "ongoing", field: "start", end: "end" },
            and: [{ field: "all_day", value: false }, { field: "hidden", value: false }],
            score: 85,
            reason: "Happening now",
            preview: ["location", "description"],
          },
          {
            when: { op: "within_next", field: "start", hours: 3 },
            and: [{ field: "all_day", value: false }, { field: "hidden", value: false }],
            score: 95,
            reason: "Soon",
            preview: ["location", "description"],
          },
          {
            when: { op: "ongoing", field: "start", end: "end" },
            and: [{ field: "all_day", value: true }, { field: "hidden", value: false }],
            score: 40,
            reason: "Today",
            preview: ["location", "description"],
          },
        ],
      },
      {
        op: "set_binding",
        binding: {
          connector: "google-calendar",
          kind: "event",
          label: "Google Calendar",
          fields: [
            { source: "title", target: "title", mode: "sync" },
            { source: "start", target: "start", mode: "sync" },
            { source: "end", target: "end", mode: "sync" },
            { source: "allDay", target: "all_day", mode: "sync" },
            { source: "calendar", target: "calendar", mode: "sync" },
            { source: "location", target: "location", mode: "sync" },
            { source: "description", target: "description", mode: "sync" },
            { source: "response", target: "response", mode: "pull" },
            { source: "people", target: "people", mode: "pull" },
          ],
          lock: { fact: "editable" },
          create: { targetField: "calendar" },
          delete: "push",
          // Answers go to the organizer; Hide stays private.
          actions: [
            { id: "accept", label: "Accept", act: "rsvp", args: { response: "accepted" }, when: [{ fact: "canRsvp" }], unless: [{ fact: "selfResponse", equals: "accepted" }] },
            { id: "maybe", label: "Maybe", act: "rsvp", args: { response: "tentative" }, when: [{ fact: "canRsvp" }], unless: [{ fact: "selfResponse", equals: "tentative" }] },
            { id: "decline", label: "Decline", act: "rsvp", args: { response: "declined" }, when: [{ fact: "canRsvp" }], unless: [{ fact: "selfResponse", equals: "declined" }] },
          ],
        },
      },
      // Hidden, bound and silent until the Calendar Chamber's cutover (phase 6 step 4).
      { op: "set_type_meta", hidden: true },
    ],
  ],
};
