import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listAccounts } from "../google/accounts.js";
import { listEvents, searchEvents, createEvent, updateEvent, deleteEvent, setEventAttendance } from "../google/events.js";

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
      description:
        "List events across all selected calendars in a date range (ISO 8601 datetimes). Excludes events marked not-attending (a real Google decline, or a local not-attending note) - use search_events to find those.",
      inputSchema: { from: z.string(), to: z.string() },
    },
    async ({ from, to }) => textResult(await listEvents(from, to))
  );

  server.registerTool(
    "search_events",
    {
      title: "Search Events",
      description:
        "Search events by title/description/location across all selected calendars, within a rolling ~6-month window centered on now. Unlike list_events, this includes events marked not-attending.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().positive().max(50).default(20) },
    },
    async ({ query, limit }) => textResult(await searchEvents(query, limit))
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
    "set_event_attendance",
    {
      title: "Set Event Attendance",
      description:
        "Mark an event as attending or not attending. If it's an invitation (this account is a listed attendee who didn't organize it), this declines/accepts the real Google invite - visible to the organizer and other guests. Otherwise it's just a private local note.",
      inputSchema: {
        accountId: z.number().int(),
        calendarId: z.string().min(1),
        eventId: z.string().min(1),
        notAttending: z.boolean(),
      },
    },
    async ({ accountId, calendarId, eventId, notAttending }) =>
      textResult(await setEventAttendance(accountId, calendarId, eventId, notAttending))
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
