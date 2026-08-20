import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "automation",
  displayName: "Automation",
  version: "0.1.0",
  routes: {
    home: "/automation",
    settings: "/automation/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // One example widget for Capitol's homepage canvas - add more entries here
  // (each with its own id/width/height/label) as this Chamber grows more
  // than one. width/height are in canvas cells, fixed by this Chamber, not
  // user-resizable. See frontend/src/widgets/ for the matching component.
  widgets: [{ id: "recent", width: 2, height: 3, label: "Recent" }],
  events: [
    { type: "automation.created", label: "Automation created", description: "A new automation was created." },
    { type: "automation.updated", label: "Automation updated", description: "An automation's rule changed." },
    { type: "automation.deleted", label: "Automation deleted", description: "An automation was deleted." },
    {
      type: "automation.run_succeeded",
      label: "Automation run succeeded",
      description: "An automation fired and its tool call succeeded. Triggering another automation off this can loop if misconfigured - target this Chamber with care.",
    },
    {
      type: "automation.run_failed",
      label: "Automation run failed",
      description: "An automation fired but its tool call failed, or its target Chamber/tool wasn't reachable. Triggering another automation off this can loop if misconfigured - target this Chamber with care.",
    },
  ],
};
