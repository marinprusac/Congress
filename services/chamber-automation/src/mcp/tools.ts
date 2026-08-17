import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import {
  listAutomations,
  listRecentAutomations,
  searchAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
} from "../automations.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_automations",
    {
      title: "List Automations",
      description: "List all automations, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listAutomations())
  );

  server.registerTool(
    "list_recent_automations",
    {
      title: "List Recent Automations",
      description: "List the most recently updated automations.",
      inputSchema: {},
    },
    async () => textResult(await listRecentAutomations())
  );

  server.registerTool(
    "search_automations",
    {
      title: "Search Automations",
      description: "Search automations by title or body.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchAutomations(query))
  );

  server.registerTool(
    "get_automation",
    {
      title: "Get Automation",
      description: "Get a single automation by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const automation = await getAutomation(id);
      if (!automation) return textResult({ error: "not_found", id });
      return textResult(automation);
    }
  );

  server.registerTool(
    "create_automation",
    {
      title: "Create Automation",
      description:
        "Create a new automation - listens for a Congress event type and, when it fires (and the optional condition matches), calls one MCP tool on one target Chamber with {{payload.x}}-interpolated arguments.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().default(""),
        triggerEventType: z.string().min(1),
        conditionField: z.string().optional(),
        conditionEquals: z.string().optional(),
        targetChamber: z.string().min(1),
        toolName: z.string().min(1),
        argsTemplate: z.record(z.string(), z.string()).default({}),
        enabled: z.boolean().default(true),
      },
    },
    async (input) => textResult(await createAutomation(input))
  );

  server.registerTool(
    "update_automation",
    {
      title: "Update Automation",
      description: "Update an existing automation's fields by id.",
      inputSchema: {
        id: z.number().int(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        triggerEventType: z.string().min(1).optional(),
        conditionField: z.string().nullable().optional(),
        conditionEquals: z.string().nullable().optional(),
        targetChamber: z.string().min(1).optional(),
        toolName: z.string().min(1).optional(),
        argsTemplate: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ id, ...input }) => {
      const updated = await updateAutomation(id, input);
      if (!updated) return textResult({ error: "not_found", id });
      return textResult(updated);
    }
  );

  server.registerTool(
    "delete_automation",
    {
      title: "Delete Automation",
      description: "Delete an automation by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const deleted = await deleteAutomation(id);
      if (!deleted) return textResult({ error: "not_found", id });
      return textResult({ ok: true });
    }
  );

  server.registerTool(
    "list_automation_runs",
    {
      title: "List Automation Runs",
      description: "List an automation's recent activity (calls attempted and their results/errors) by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => textResult(await listAutomationRuns(id))
  );
}
