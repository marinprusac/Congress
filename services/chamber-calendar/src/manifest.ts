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
    { type: "calendar.event_created", label: "Event created", description: "A new event was created on a connected calendar." },
    { type: "calendar.event_updated", label: "Event updated", description: "An event on a connected calendar changed." },
    { type: "calendar.event_deleted", label: "Event deleted", description: "An event on a connected calendar was deleted." },
    {
      type: "calendar.event_attendance_changed",
      label: "Attendance changed",
      description:
        "This account's attendance on an event changed - a real Google accept/decline on an invitation, or a local not-attending note on any other event.",
    },
    { type: "calendar.account_connected", label: "Account connected", description: "A new Google account was connected." },
    { type: "calendar.account_disconnected", label: "Account disconnected", description: "A Google account was disconnected." },
  ],
};
