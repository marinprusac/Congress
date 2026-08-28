import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { priorityLevelSchema } from "@congress/shared-types";
import { listTasks, listOpenTasks, searchTasks, getTask, createTask, updateTask, deleteTask } from "../tasks.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List all tasks, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listTasks())
  );

  server.registerTool(
    "list_open_tasks",
    {
      title: "List Open Tasks",
      description: "List incomplete tasks, soonest due date first.",
      inputSchema: {},
    },
    async () => textResult(await listOpenTasks())
  );

  server.registerTool(
    "search_tasks",
    {
      title: "Search Tasks",
      description: "Search tasks by name or description.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchTasks(query))
  );

  server.registerTool(
    "get_task",
    {
      title: "Get Task",
      description: "Get a single task by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const task = await getTask(id);
      if (!task) return textResult({ error: "not_found", id });
      return textResult(task);
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description: "Create a new task, optionally with a due date (ISO 8601) and priority (default normal).",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().default(""),
        dueDate: z.string().optional(),
        priority: priorityLevelSchema.default("normal"),
      },
    },
    async ({ name, description, dueDate, priority }) =>
      textResult(await createTask({ name, description, dueDate, priority }))
  );

  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description: "Update an existing task's fields by id.",
      inputSchema: {
        id: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        completed: z.boolean().optional(),
        priority: priorityLevelSchema.optional(),
      },
    },
    async ({ id, name, description, dueDate, completed, priority }) => {
      const updated = await updateTask(id, { name, description, dueDate, completed, priority });
      if (!updated) return textResult({ error: "not_found", id });
      return textResult(updated);
    }
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete Task",
      description: "Delete a task by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const deleted = await deleteTask(id);
      if (!deleted) return textResult({ error: "not_found", id });
      return textResult({ ok: true, id });
    }
  );
}
