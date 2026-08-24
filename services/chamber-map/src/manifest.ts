import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "map",
  displayName: "Map",
  version: "0.1.0",
  routes: {
    home: "/map",
    settings: "/map/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // width/height are in canvas cells, fixed by this Chamber, not
  // user-resizable. See frontend/src/widgets/ for the matching components.
  widgets: [
    { id: "recent-visits", width: 2, height: 3, label: "Recent Visits" },
    { id: "today-map", width: 4, height: 3, label: "Today's Map" },
  ],
  // Purely a declared catalog for Logs/Automation Chambers' own trigger-event
  // pickers - Congress never enforces or inspects this. Published via
  // events.ts's publishEvent from tracking.ts/poller.ts.
  events: [
    { type: "map.arrived_at_place", label: "Arrived at place", description: "The tracked device arrived at a known place." },
    { type: "map.departed_place", label: "Departed place", description: "The tracked device left a known place." },
    { type: "map.trip_completed", label: "Trip completed", description: "A trip between two visits was summarized." },
    {
      type: "map.unclassified_dwell_pending",
      label: "Unclassified dwell pending",
      description: "The device has been dwelling at an unrecognized location and needs classification.",
    },
    {
      type: "map.trip_needs_label",
      label: "Trip needs a label",
      description: "A round trip to the same known place with no stop recorded in between needs a purpose label.",
    },
    {
      type: "map.traccar_poll_failing",
      label: "Traccar poll failing",
      description: "Polling the Traccar server has failed several times in a row.",
    },
  ],
};
