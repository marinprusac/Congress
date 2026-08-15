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
    widget: "/__CHAMBER_NAME__/widget",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Optional: set to "markdown" once this Chamber's exhibit bodies use
  // [[wikilink]]/Markdown syntax, so Capitol's Exhibit Sharing viewer knows
  // to render them that way for logged-out viewers - see
  // services/capitol/frontend/src/pages/SharedViewPage.tsx.
  // contentFormat: "markdown",
};
