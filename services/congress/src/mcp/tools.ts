import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../kit/mcp.js";
import { buildChipToken } from "@congress/shared-types";
import { registerAskTools } from "./askTools.js";
import { registerMemoryTools } from "./memoryTools.js";
import {
  searchExhibits,
  resolveExhibits,
  getExhibitChip,
  getConnections,
  addManualConnection,
  removeManualConnection,
} from "../exhibits.js";
import { listEventSettings, getEventSettingsByType, updateEventSettings } from "../eventSettings.js";
import { listHistory } from "../eventHistory.js";
import { listNotifications, dismissNotification } from "../notifications.js";

export function registerTools(server: McpServer) {
  server.registerTool(
    "search_exhibits",
    {
      title: "Search Exhibits",
      description:
        "Search for Exhibits (notes, calendar events, and other referenceable objects) across every active Chamber. Each result's `token` is the exact chip to paste into a reply.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const results = await searchExhibits(query);
      return mcpTextResult(results.map((r) => ({ ...r, token: buildChipToken({ chamber: r.chamber, id: r.id, name: r.name }) })));
    }
  );

  server.registerTool(
    "resolve_exhibits",
    {
      title: "Resolve Exhibits",
      description:
        "Batch-resolve a list of Exhibit references (id + owning chamber) into their current name/url, or a deleted/unavailable status.",
      inputSchema: {
        refs: z.array(z.object({ id: z.string().min(1), chamber: z.string().min(1) })),
      },
    },
    async ({ refs }) => {
      const results = await resolveExhibits(refs);
      return mcpTextResult(results.map((r) => ("name" in r ? { ...r, token: buildChipToken({ chamber: r.chamber, id: r.id, name: r.name }) } : r)));
    }
  );

  server.registerTool(
    "get_exhibit_chip",
    {
      title: "Get Exhibit Chip",
      description:
        "Build a ready-to-paste [[exhibit:chamber:id|Name]] chip token for an object you just created or fetched via that Chamber's own domain tools (e.g. create_task's or get_task's returned numeric id). Input is the Chamber's own RAW id (e.g. the task's plain numeric id, not \"task-7\") - this tool encodes it into the correct Exhibit id and resolves it for you.",
      inputSchema: { chamber: z.string().min(1), id: z.string().min(1) },
    },
    async ({ chamber, id }) => {
      const result = await getExhibitChip(chamber, id);
      return mcpTextResult(result);
    }
  );

  server.registerTool(
    "get_exhibit_connections",
    {
      title: "Get Exhibit Connections",
      description:
        "List every other Exhibit connected to the given Exhibit (full id, e.g. \"task-7\"), whether the connection came from a [[wikilink]] in body text or was added manually - each resolved to its current name/url, or a deleted/unavailable status.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const connections = await getConnections(id);
      return mcpTextResult(connections);
    }
  );

  server.registerTool(
    "create_exhibit_connection",
    {
      title: "Create Exhibit Connection",
      description:
        "Add a manual Connection between two Exhibits (full ids, e.g. \"task-7\" and \"note-12\") - shows up in both Exhibits' Connections without editing either body's text. Pass targetChamber when known (e.g. it came from search_exhibits) so the target gets cached immediately even if it's never been created/edited within Congress.",
      inputSchema: {
        id: z.string().min(1),
        targetExhibitId: z.string().min(1),
        targetChamber: z.string().optional(),
      },
    },
    async ({ id, targetExhibitId, targetChamber }) => {
      const result = await addManualConnection(id, targetExhibitId, targetChamber);
      return mcpTextResult(result);
    }
  );

  server.registerTool(
    "delete_exhibit_connection",
    {
      title: "Delete Exhibit Connection",
      description:
        "Remove a manual Connection between two Exhibits (full ids). Only removes connections added manually - one derived from body text (a [[wikilink]] token) can only be removed by editing that text.",
      inputSchema: { id: z.string().min(1), otherExhibitId: z.string().min(1) },
    },
    async ({ id, otherExhibitId }) => {
      const result = await removeManualConnection(id, otherExhibitId);
      return mcpTextResult(result);
    }
  );

  server.registerTool(
    "list_event_settings",
    {
      title: "List Event Settings",
      description:
        "List every known event type (auto-derived from the live Chamber registry) and its current record-to-history/notify configuration.",
      inputSchema: {},
    },
    async () => mcpTextResult(await listEventSettings())
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
      if (!row) return mcpTextResult({ error: "not_found", eventType });
      return mcpTextResult(row);
    }
  );

  server.registerTool(
    "update_event_settings",
    {
      title: "Update Event Settings",
      description:
        "Update an event type's settings - whether to record firings to Congress's durable history and/or push a templated notification, independently. There is no create/delete: every known event type already has a row.",
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
      if (!updated) return mcpTextResult({ error: "not_found", eventType });
      return mcpTextResult(updated);
    }
  );

  server.registerTool(
    "list_event_history",
    {
      title: "List Event History",
      description:
        "List Congress's recorded event history, most recent first. Each entry has an `actor` - who performed the action that produced the event (\"me\" for the owner, \"deputy\", \"automation\", \"system\" for timers/pollers). Pass `actor` to see only one party's actions, e.g. \"deputy\" for your own.",
      inputSchema: { limit: z.number().int().positive().optional(), actor: z.string().optional() },
    },
    async ({ limit, actor }) => mcpTextResult(listHistory({ limit, actor }))
  );

  server.registerTool(
    "list_inbox",
    {
      title: "List Inbox",
      description:
        "List the owner-facing notification inbox (most recent first, capped at 50) plus the current unread count. Distinct from list_event_history: this is live current state (upserted/deduped per event type), not an append-only record.",
      inputSchema: {},
    },
    async () => mcpTextResult(listNotifications())
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
      if (!dismissed) return mcpTextResult({ error: "not_found", id });
      return mcpTextResult({ ok: true, id });
    }
  );

  registerAskTools(server);
  registerMemoryTools(server);
}
