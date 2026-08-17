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
  // Optional: set to "markdown" once this Chamber's exhibit bodies use
  // [[wikilink]]/Markdown syntax, so Capitol's Exhibit Sharing viewer knows
  // to render them that way for logged-out viewers - see
  // services/congress/frontend/src/pages/SharedViewPage.tsx.
  // contentFormat: "markdown",
  // One example widget for Capitol's homepage canvas - add more entries here
  // (each with its own id/width/height/label) as this Chamber grows more
  // than one. width/height are in canvas cells, fixed by this Chamber, not
  // user-resizable. See frontend/src/widgets/ for the matching component.
  widgets: [{ id: "recent", width: 2, height: 3, label: "Recent" }],
  events: [],
};
