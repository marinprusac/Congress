import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const calendarManifest: Manifest = {
  name: "calendar",
  displayName: "Calendar",
  version: "0.1.0",
  routes: {
    home: "/calendar",
    settings: "/calendar/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [{ id: "upcoming", width: 3, height: 2, label: "Upcoming" }],
  events: [
    {
      type: "calendar.event_starting_soon",
      label: "Event starting soon",
      description: "A timed event on a connected calendar starts within 30 minutes.",
    },
  ],
};
