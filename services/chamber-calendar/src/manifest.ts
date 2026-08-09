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
    widget: "/calendar/widget",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
};
