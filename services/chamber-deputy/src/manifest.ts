import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const manifest: Manifest = {
  name: "deputy",
  displayName: "Deputy",
  version: "0.1.0",
  routes: {
    home: "/deputy",
    settings: "/deputy/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // §12: a quick "message Deputy" box. Deputy keeps no run-history page or
  // widget of its own any more - see deputy.directive_run below, which the
  // Logs Chamber's own widgets (recent-logs/urgent-logs) can surface instead
  // once the owner sets up a rule for it.
  widgets: [{ id: "message", width: 2, height: 1, label: "Message Deputy" }],
  events: [
    {
      type: "deputy.report",
      label: "Deputy report",
      description: "Published by a chat/urgent run when it takes a real action (calls a tool) worth surfacing to the owner.",
    },
    {
      type: "deputy.directive_run",
      label: "Directive run",
      description: "Published every time one directive's own scheduled or manual run completes, with its full transcript.",
    },
  ],
};
