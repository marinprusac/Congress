import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "logs",
  displayName: "Logs",
  version: "0.1.0",
  routes: {
    home: "/logs",
    settings: "/logs/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // width/height are in canvas cells, fixed by this Chamber, not
  // user-resizable. See frontend/src/widgets/ for the matching components.
  widgets: [
    { id: "recent-logs", width: 2, height: 3, label: "Recent Logs" },
    // The bell+panel notification center itself - see NotificationsWidget's
    // own comment for why this replaced the old Capitol-header-mounted bell.
    { id: "bell", width: 1, height: 1, label: "Notifications" },
  ],
  events: [
    {
      type: "logs.rule_updated",
      label: "Log rule updated",
      description: "The owner changed a per-event-type record/notify setting - useful for spotting why an expected notification went quiet.",
      payloadFields: { eventType: { type: "string" }, label: { type: "string" } },
    },
  ],
};
