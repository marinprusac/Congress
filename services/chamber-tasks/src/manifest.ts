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
  widgets: [{ id: "open", width: 3, height: 2, label: "Open" }],
  events: [
    { type: "tasks.due_soon", label: "Task due soon", description: "An incomplete task's due date is within 24 hours." },
    { type: "tasks.overdue", label: "Task overdue", description: "An incomplete task's due date has passed." },
    { type: "tasks.due_cleared", label: "Task no longer due", description: "A previously due/overdue task was completed or its due date moved out of range." },
  ],
};
