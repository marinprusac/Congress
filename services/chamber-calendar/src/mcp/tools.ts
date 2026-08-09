import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAccounts } from "../google/accounts.js";
import { listEvents, createEvent, updateEvent, deleteEvent } from "../google/events.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_accounts",
    {
      title: "List Connected Google Accounts",
      description: "List Google accounts connected to the Calendar Chamber.",
      inputSchema: {},
    },
    async () => textResult(listAccounts())
  );

  server.registerTool(
    "list_events",
    {
      title: "List Events",
      description: "List events across all selected calendars in a date range (ISO 8601 datetimes).",
      inputSchema: { from: z.string(), to: z.string() },
    },
    async ({ from, to }) => textResult(await listEvents(from, to))
  );

  server.registerTool(
    "create_event",
    {
      title: "Create Event",
      description: "Create a new event on a connected account's calendar.",
      inputSchema: {
        accountId: z.number().int(),
        calendarId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        allDay: z.boolean(),
        start: z.string(),
        end: z.string(),
        timeZone: z.string().min(1),
      },
    },
    async (input) => textResult(await createEvent(input))
  );

  server.registerTool(
    "update_event",
    {
      title: "Update Event",
      description: "Update an existing event by account, calendar, and event id.",
      inputSchema: {
        accountId: z.number().int(),
        calendarId: z.string().min(1),
        eventId: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        allDay: z.boolean().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        timeZone: z.string().min(1).optional(),
      },
    },
    async ({ accountId, calendarId, eventId, ...input }) =>
      textResult(await updateEvent(accountId, calendarId, eventId, input))
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete Event",
      description: "Delete an event by account, calendar, and event id.",
      inputSchema: {
        accountId: z.number().int(),
        calendarId: z.string().min(1),
        eventId: z.string().min(1),
      },
    },
    async ({ accountId, calendarId, eventId }) => {
      await deleteEvent(accountId, calendarId, eventId);
      return textResult({ deleted: true, accountId, calendarId, eventId });
    }
  );
}
