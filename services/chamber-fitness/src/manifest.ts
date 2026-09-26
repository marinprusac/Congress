import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "fitness",
  displayName: "Fitness",
  version: "0.1.0",
  routes: {
    home: "/fitness",
    settings: "/fitness/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [
    { id: "recent-workouts", width: 3, height: 2, label: "Recent Workouts" },
    { id: "week-stats", width: 2, height: 1, label: "This Week" },
    { id: "health-snapshot", width: 3, height: 2, label: "Health" },
  ],
  // Home feed cards (the remote entry's `views` export) and "+"-creatable
  // Exhibit types - see shared-types' manifestViewSchema/manifestExhibitTypeSchema.
  views: [
    { id: "week-stats", label: "This week" },
    { id: "recent-workouts", label: "Recent workouts" },
    { id: "health-snapshot", label: "Health", fullPath: "/metrics" },
  ],
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
