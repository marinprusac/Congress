import type { Premade } from "./index.js";

// Replace the Fitness Chamber: workouts and routines from Hevy. Health stays
// a time series in the health connector, drawn by the Health view.

export const WORKOUT: Premade = {
  key: "workout",
  batches: [
    [
      { op: "create_type", slug: "workout", label: "Workout", pluralLabel: "Workouts", icon: "fitness" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "start", label: "Start", kind: "datetime", options: { indexed: true } },
      { op: "add_field", slug: "end", label: "End", kind: "datetime" },
      { op: "set_time_range", range: { start: "start", end: "end", allDay: null } },
      { op: "add_field", slug: "exercises", label: "Exercises", kind: "text", options: { searchable: true } },
      { op: "add_field", slug: "exercise_count", label: "Exercise count", kind: "number" },
      { op: "add_field", slug: "volume_kg", label: "Volume (kg)", kind: "number" },
      {
        op: "set_feed_rules",
        rules: [{ when: { op: "within_last", field: "end", hours: 12 }, score: 50, reason: "Just trained", preview: ["exercises", "volume_kg"] }],
      },
      {
        op: "set_binding",
        binding: {
          connector: "hevy",
          kind: "workout",
          label: "Hevy",
          fields: [
            { source: "title", target: "title", mode: "pull" },
            { source: "start", target: "start", mode: "pull" },
            { source: "end", target: "end", mode: "pull" },
            { source: "exercises", target: "exercises", mode: "pull" },
            { source: "exerciseCount", target: "exercise_count", mode: "pull" },
            { source: "volumeKg", target: "volume_kg", mode: "pull" },
          ],
          delete: "never",
          actions: [],
        },
      },
      // Hidden, bound and silent until the Fitness Chamber's cutover (phase 7b).
      { op: "set_type_meta", hidden: true },
    ],
    // Cutover: in use.
    [{ op: "set_type_meta", hidden: false }],
  ],
};

export const ROUTINE: Premade = {
  key: "routine",
  batches: [
    [
      { op: "create_type", slug: "routine", label: "Routine", pluralLabel: "Routines", icon: "fitness" },
      { op: "add_field", slug: "title", label: "Title", kind: "text", options: { required: true, searchable: true } },
      { op: "set_title_field", field: "title" },
      { op: "add_field", slug: "folder", label: "Folder", kind: "text" },
      { op: "add_field", slug: "exercises", label: "Exercises", kind: "text", options: { searchable: true } },
      { op: "add_field", slug: "exercise_count", label: "Exercise count", kind: "number" },
      {
        op: "set_binding",
        binding: {
          connector: "hevy",
          kind: "routine",
          label: "Hevy",
          // A rename goes to Hevy; exercises are edited in the routine's own editor.
          fields: [
            { source: "title", target: "title", mode: "sync" },
            { source: "folder", target: "folder", mode: "pull" },
            { source: "exercises", target: "exercises", mode: "pull" },
            { source: "exerciseCount", target: "exercise_count", mode: "pull" },
          ],
          delete: "never",
          actions: [],
        },
      },
      { op: "set_type_meta", hidden: true },
    ],
    [{ op: "set_type_meta", hidden: false }],
  ],
};
