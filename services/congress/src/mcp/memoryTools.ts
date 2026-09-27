import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "@congress/chamber-kit";
import { factTextSchema, recurrenceSchema, trackingStatusSchema, watchEventSchema } from "@congress/shared-types";
import { currentRunContext } from "../ai/runContext.js";
import { getAiSettings } from "../ai/settings.js";
import { addFact, createTracking, deleteFact, getTracking, listFacts, listTracking, updateFact, updateTracking } from "../ai/memory.js";

const iso = z.string().datetime({ offset: true });

// The AI's memory: tracked items (with their own schedule) and facts.
export function registerMemoryTools(server: McpServer) {
  server.registerTool(
    "track",
    {
      title: "Track",
      description:
        "Start keeping an eye on something for the owner - a deadline, a habit, a condition to watch, something to follow up on. Congress runs a check for it at nextCheckAt (and then per recurrence), and immediately when an 'immediate' watched event happens. Write the body as your own instructions for future checks: what to look at, when to reach the owner, when it's done.",
      inputSchema: {
        title: z.string().min(1).max(120),
        body: z.string().max(4000).describe("What to watch and what to do - your notes for future checks."),
        nextCheckAt: iso.optional().describe("First check (ISO with offset). Defaults to the next recurrence slot."),
        recurrence: recurrenceSchema.optional().describe("Checks repeat on this schedule in the owner's time zone."),
        watchEvents: z.array(watchEventSchema).max(20).optional().describe('Event types that matter, e.g. {"type":"tasks.overdue","immediate":true}.'),
        refs: z.array(z.string()).max(20).optional().describe("Related exhibit tokens."),
      },
    },
    async ({ title, body, nextCheckAt, recurrence, watchEvents, refs }) => {
      const settings = await getAiSettings();
      const ctx = currentRunContext();
      const item = createTracking(
        { title, body, recurrence, watchEvents, refs, nextCheckAt: nextCheckAt ? new Date(nextCheckAt) : null, threadId: ctx.threadId, source: ctx.threadId ? "chat" : "ai" },
        settings.timeZone
      );
      return mcpTextResult({ ok: true, item });
    }
  );

  server.registerTool(
    "update_tracking",
    {
      title: "Update Tracking",
      description: "Update a tracked item: progress notes (body), schedule, watched events, or status (done/dropped when it no longer applies, paused to stop checks).",
      inputSchema: {
        id: z.number().int(),
        title: z.string().min(1).max(120).optional(),
        body: z.string().max(4000).optional(),
        status: trackingStatusSchema.optional(),
        nextCheckAt: iso.nullable().optional(),
        recurrence: recurrenceSchema.nullable().optional(),
        watchEvents: z.array(watchEventSchema).max(20).optional(),
        refs: z.array(z.string()).max(20).optional(),
      },
    },
    async ({ id, ...patch }) => {
      const item = updateTracking(id, patch);
      return mcpTextResult(item ? { ok: true, item } : { error: "not_found", id });
    }
  );

  server.registerTool(
    "list_tracking",
    {
      title: "List Tracking",
      description: "Every tracked item with its full notes and schedule (the prompt only shows a summary).",
      inputSchema: { includeClosed: z.boolean().optional().describe("Also list done/dropped items.") },
    },
    async ({ includeClosed }) => mcpTextResult(listTracking(includeClosed ? undefined : ["active", "paused"]))
  );

  server.registerTool(
    "get_tracking",
    { title: "Get Tracking", description: "One tracked item in full.", inputSchema: { id: z.number().int() } },
    async ({ id }) => mcpTextResult(getTracking(id) ?? { error: "not_found", id })
  );

  server.registerTool(
    "remember_fact",
    {
      title: "Remember Fact",
      description:
        "Remember a durable fact about the owner (a preference, routine, person, place) so future runs know it. One short sentence; don't store things that are already in their data.",
      inputSchema: { text: factTextSchema },
    },
    async ({ text }) => {
      const duplicate = listFacts().find((f) => f.text.toLowerCase() === text.toLowerCase());
      return mcpTextResult(duplicate ? { ok: true, fact: duplicate, note: "already known" } : { ok: true, fact: addFact(text, "ai") });
    }
  );

  server.registerTool(
    "update_fact",
    { title: "Update Fact", description: "Correct a remembered fact.", inputSchema: { id: z.number().int(), text: factTextSchema } },
    async ({ id, text }) => mcpTextResult(updateFact(id, text) ?? { error: "not_found", id })
  );

  server.registerTool(
    "forget_fact",
    { title: "Forget Fact", description: "Forget a fact that's wrong or no longer true.", inputSchema: { id: z.number().int() } },
    async ({ id }) => mcpTextResult(deleteFact(id) ? { ok: true, id } : { error: "not_found", id })
  );
}
