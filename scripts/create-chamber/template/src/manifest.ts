import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "__CHAMBER_NAME__",
  displayName: "__CHAMBER_DISPLAY__",
  version: "0.1.0",
  routes: {
    home: "/__CHAMBER_NAME__",
    settings: "/__CHAMBER_NAME__/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Home feed cards (the remote entry's `views` export) and what the home
  // screen's "+" can create here.
  views: [{ id: "recent", label: "Recent items" }],
  exhibitTypes: [{ type: "item", label: "Item", createPath: "/new" }],
  events: [],
};
