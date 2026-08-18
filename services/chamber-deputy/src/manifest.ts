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
  // Directive bodies are Markdown/[[wikilink]] text like every other
  // Exhibit body in this system - see Capitol's Exhibit Sharing viewer.
  contentFormat: "markdown",
  // §12: a quick "message Deputy" box, and a recent-activity feed reading
  // deputy_runs for a lightweight "what has Deputy been doing" glance
  // without opening the full audit log/run history page.
  widgets: [
    { id: "message", width: 2, height: 1, label: "Message Deputy" },
    { id: "recent-activity", width: 2, height: 3, label: "Recent Activity" },
  ],
  // §7: published only when a run actually took a real action - Logs
  // Chamber's own rules (a minPriority threshold) decide whether that's
  // worth recording/notifying.
  events: [
    {
      type: "deputy.report",
      label: "Deputy report",
      description: "Published when Deputy takes a real action (calls a tool) worth surfacing to the owner.",
    },
  ],
};
