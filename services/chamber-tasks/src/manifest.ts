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
    {
      type: "tasks.due_soon",
      label: "Task due soon",
      description: "An incomplete task's due date is within 24 hours.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "tasks.overdue",
      label: "Task overdue",
      description: "An incomplete task's due date has passed.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "tasks.due_cleared",
      label: "Task no longer due",
      description: "A previously due/overdue task was completed or its due date moved out of range.",
      payloadFields: { taskId: { type: "number" } },
    },
    {
      type: "tasks.created",
      label: "Task created",
      description: "A new task was created.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "tasks.updated",
      label: "Task updated",
      description: "A task's fields changed.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "tasks.deleted",
      label: "Task deleted",
      description: "A task was deleted.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" } },
    },
    {
      type: "tasks.completed",
      label: "Task completed",
      description: "A task was marked complete.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
    {
      type: "tasks.reopened",
      label: "Task reopened",
      description: "A previously completed task was marked incomplete again.",
      payloadFields: { taskId: { type: "number" }, name: { type: "string" }, url: { type: "string" } },
    },
  ],
};
