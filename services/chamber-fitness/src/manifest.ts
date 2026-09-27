import type { Manifest } from "@congress/shared-types";

export const manifest: Manifest = {
  name: "fitness",
  displayName: "Fitness",
  version: "0.1.0",
  routes: {
    home: "/fitness",
    settings: "/fitness/settings",
  },
  // Views are only genuine screens (see shared-types' manifestViewSchema) -
  // this Chamber's exhibits reach the home feed and Search on their own.
  // exhibitTypes is what the home screen's "+" can create here.
  views: [{ id: "health", label: "Health", fullPath: "/metrics", card: true }],
  exhibitTypes: [{ type: "routine", label: "Routine", createPath: "/routines/new" }],
  events: [
    {
      type: "fitness.workout_synced",
      label: "Workout synced",
      description: "A new workout was pulled in from Hevy.",
      payloadFields: { workoutId: { type: "number" }, title: { type: "string" } },
    },
    {
      type: "fitness.sync_failing",
      label: "Hevy sync failing",
      description: "The Hevy poll loop has failed several times in a row.",
      payloadFields: { consecutiveFailures: { type: "number" }, lastError: { type: "string" } },
    },
    {
      type: "fitness.health_metric_received",
      label: "Health metric received",
      description: "New or changed Apple Health samples were ingested via the Shortcuts automation.",
      payloadFields: { count: { type: "number" } },
    },
  ],
};
