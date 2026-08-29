import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listEventSettings, getEventSettingsByType, updateEventSettings } from "../eventSettings.js";
import { listHistory } from "../eventHistory.js";
import { listNotifications, dismissNotification } from "../notifications.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_event_settings",
    {
      title: "List Event Settings",
      description:
        "List every known event type (auto-derived from the live Chamber registry) and its current record-to-history/notify configuration.",
      inputSchema: {},
    },
    async () => textResult(await listEventSettings())
  );

  server.registerTool(
    "get_event_settings",
    {
      title: "Get Event Settings",
      description: "Get a single event type's settings by its event type string (e.g. \"tasks.due_soon\").",
      inputSchema: { eventType: z.string().min(1) },
    },
    async ({ eventType }) => {
      const row = await getEventSettingsByType(eventType);
      if (!row) return textResult({ error: "not_found", eventType });
      return textResult(row);
    }
  );

  server.registerTool(
    "update_event_settings",
    {
      title: "Update Event Settings",
      description:
        "Update an event type's settings - whether to record firings to this Chamber's durable history and/or push a templated notification, independently. There is no create/delete: every known event type already has a row.",
      inputSchema: {
        eventType: z.string().min(1),
        recordToHistory: z.boolean().optional(),
        historyRetentionMs: z.number().int().positive().nullable().optional(),
        notify: z.boolean().optional(),
        notifyTitleTemplate: z.string().nullable().optional(),
        notifyBodyTemplate: z.string().nullable().optional(),
        notifyUrlTemplate: z.string().nullable().optional(),
        notifyDedupeKeyTemplate: z.string().nullable().optional(),
      },
    },
    async ({ eventType, ...input }) => {
      const updated = await updateEventSettings(eventType, input);
      if (!updated) return textResult({ error: "not_found", eventType });
      return textResult(updated);
    }
  );

  server.registerTool(
    "list_event_history",
    {
      title: "List Event History",
      description: "List this Chamber's recorded event history, most recent first.",
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async ({ limit }) => textResult(listHistory({ limit }))
  );

  server.registerTool(
    "list_inbox",
    {
      title: "List Inbox",
      description:
        "List the owner-facing notification inbox (most recent first, capped at 50) plus the current unread count. Distinct from list_event_history: this is live current state (upserted/deduped per event type), not an append-only record.",
      inputSchema: {},
    },
    async () => textResult(listNotifications())
  );

  server.registerTool(
    "dismiss_notification",
    {
      title: "Dismiss Notification",
      description:
        "Dismiss (permanently remove) a notification from the inbox by id. If the condition that raised it still holds, the next matching event re-creates it.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const dismissed = dismissNotification(id);
      if (!dismissed) return textResult({ error: "not_found", id });
      return textResult({ ok: true, id });
    }
  );
}
