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
  ],
  events: [
    { type: "fitness.workout_synced", label: "Workout synced", description: "A new workout was pulled in from Hevy." },
    {
      type: "fitness.sync_failing",
      label: "Hevy sync failing",
      description: "The Hevy poll loop has failed several times in a row.",
    },
  ],
};
