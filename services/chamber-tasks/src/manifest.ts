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
    widget: "/tasks/widget",
  },
  apiBase: `${base}/api`,
  mcpUrl: `${base}/mcp`,
  healthUrl: `${base}/health`,
};
