import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const notesManifest: Manifest = {
  name: "notes",
  displayName: "Notes",
  version: "0.1.0",
  routes: {
    home: "/notes",
    settings: "/notes/settings",
    widget: "/notes/widget",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  // Note bodies use [[wikilink]]/Markdown syntax - see
  // services/congress/frontend/src/pages/SharedViewPage.tsx.
  contentFormat: "markdown",
};
