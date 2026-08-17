import type { Manifest } from "@congress/shared-types";
import { env } from "./env.js";

const base = `http://${env.HOST}:${env.PORT}`;

export const tasksManifest: Manifest = {
  name: "tasks",
  displayName: "Tasks",
  version: "0.1.0",
  routes: {
    home: "/tasks",
    settings: "/tasks/settings",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
  widgets: [{ id: "open", width: 2, height: 2, label: "Open" }],
};
