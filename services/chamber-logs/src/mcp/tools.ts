import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { priorityLevelSchema } from "@congress/shared-types";
import { listLogRules, listRecentLogRules, searchLogRules, getLogRule, createLogRule, updateLogRule, deleteLogRule } from "../logRules.js";
import { listHistory } from "../eventHistory.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_log_rules",
    {
      title: "List Log Rules",
      description: "List all log rules, most recently updated first.",
      inputSchema: {},
    },
    async () => textResult(await listLogRules())
  );

  server.registerTool(
    "list_recent_log_rules",
    {
      title: "List Recent Log Rules",
      description: "List the most recently updated log rules.",
      inputSchema: {},
    },
    async () => textResult(await listRecentLogRules())
  );

  server.registerTool(
    "search_log_rules",
    {
      title: "Search Log Rules",
      description: "Search log rules by title or body.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchLogRules(query))
  );

  server.registerTool(
    "get_log_rule",
    {
      title: "Get Log Rule",
      description: "Get a single log rule by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const rule = await getLogRule(id);
      if (!rule) return textResult({ error: "not_found", id });
      return textResult(rule);
    }
  );

  server.registerTool(
    "create_log_rule",
    {
      title: "Create Log Rule",
      description:
        "Create a new log rule - listens for a Congress event type and, when it fires (and the optional condition/minPriority both match), records it to this Chamber's durable history and/or pushes a templated notification.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().default(""),
        triggerEventType: z.string().min(1),
        conditionField: z.string().optional(),
        conditionEquals: z.string().optional(),
        minPriority: priorityLevelSchema.optional(),
        recordToHistory: z.boolean().default(true),
        historyRetentionMs: z.number().int().positive().optional(),
        notify: z.boolean().default(false),
        notifyTitleTemplate: z.string().optional(),
        notifyBodyTemplate: z.string().optional(),
        notifyUrlTemplate: z.string().optional(),
        notifyDedupeKeyTemplate: z.string().optional(),
        enabled: z.boolean().default(true),
      },
    },
    async (input) => textResult(await createLogRule(input))
  );

  server.registerTool(
    "update_log_rule",
    {
      title: "Update Log Rule",
      description: "Update an existing log rule's fields by id.",
      inputSchema: {
        id: z.number().int(),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        triggerEventType: z.string().min(1).optional(),
        conditionField: z.string().nullable().optional(),
        conditionEquals: z.string().nullable().optional(),
        minPriority: priorityLevelSchema.nullable().optional(),
        recordToHistory: z.boolean().optional(),
        historyRetentionMs: z.number().int().positive().nullable().optional(),
        notify: z.boolean().optional(),
        notifyTitleTemplate: z.string().nullable().optional(),
        notifyBodyTemplate: z.string().nullable().optional(),
        notifyUrlTemplate: z.string().nullable().optional(),
        notifyDedupeKeyTemplate: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ id, ...input }) => {
      const updated = await updateLogRule(id, input);
      if (!updated) return textResult({ error: "not_found", id });
      return textResult(updated);
    }
  );

  server.registerTool(
    "delete_log_rule",
    {
      title: "Delete Log Rule",
      description: "Delete a log rule by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const deleted = await deleteLogRule(id);
      if (!deleted) return textResult({ error: "not_found", id });
      return textResult({ ok: true });
    }
  );

  server.registerTool(
    "list_event_history",
    {
      title: "List Event History",
      description: "List this Chamber's recorded event history, most recent first, optionally filtered to a minimum priority.",
      inputSchema: { minPriority: priorityLevelSchema.optional(), limit: z.number().int().positive().optional() },
    },
    async ({ minPriority, limit }) => textResult(listHistory({ minPriority, limit }))
  );
}
