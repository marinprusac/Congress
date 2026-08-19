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
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [{ id: "pinned", width: 3, height: 2, label: "Pinned" }],
  events: [],
};
