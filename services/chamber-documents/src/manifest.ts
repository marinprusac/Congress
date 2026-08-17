import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const documentsManifest: Manifest = {
  name: "documents",
  displayName: "Documents",
  version: "0.1.0",
  routes: {
    home: "/documents",
    settings: "/documents/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [{ id: "recent", width: 2, height: 2, label: "Recent" }],
};
