import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "../../kit/mcp.js";
import { listVisits, listVisitsCovering, listTrips } from "./visits.js";
import type { Visit } from "./types.js";
import { startOfDay, endOfDay } from "../../typeEngine/zone.js";

// The AI's read of the owner's movements (the Places themselves are the generic *_place tools).

const range = (from?: string, to?: string) => ({ from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });

function summarize(visits: Visit[]) {
  return visits
    .filter((v) => v.status === "confirmed" || v.status === "adhoc")
    .map((v) => ({ place: v.placeName ?? v.adhocLabel ?? "Unknown location", placeId: v.placeId, arrivedAt: v.arrivedAt, departedAt: v.departedAt, durationMinutes: v.durationMinutes }));
}

async function summarizeTrips(from?: string, to?: string) {
  return (await listTrips(range(from, to))).map((t) => ({
    from: t.fromLabel,
    to: t.toLabel,
    departedAt: t.departedAt,
    arrivedAt: t.arrivedAt,
    durationMinutes: t.durationMinutes,
    distanceKm: Math.round(t.distanceKm * 10) / 10,
    mode: t.mode,
  }));
}

export function registerLocationTools(server: McpServer): void {
  server.registerTool(
    "location_list_visits",
    {
      title: "List visits",
      description: "Places the owner was at in a date range, most recent first (not ones still awaiting classification or ignored).",
      inputSchema: {
        from: z.string().datetime().optional().describe("ISO timestamp, inclusive lower bound on arrival"),
        to: z.string().datetime().optional().describe("ISO timestamp, inclusive upper bound on arrival"),
      },
    },
    async ({ from, to }) => textResult(summarize(await listVisits(range(from, to))))
  );

  server.registerTool(
    "location_list_trips",
    {
      title: "List trips",
      description: "Trips (movement between two visits) in a date range, most recent first.",
      inputSchema: {
        from: z.string().datetime().optional().describe("ISO timestamp, inclusive lower bound on departure"),
        to: z.string().datetime().optional().describe("ISO timestamp, inclusive upper bound on departure"),
      },
    },
    async ({ from, to }) => textResult(await summarizeTrips(from, to))
  );

  server.registerTool(
    "location_day_summary",
    {
      title: "Day summary",
      description: "One day's visits and trips as one chronological list (the owner's local day) - the best single call for a daily recap.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD") },
    },
    async ({ date }) => {
      const [from, to] = [new Date(startOfDay(date)), new Date(endOfDay(date) - 1)];
      const [visits, trips] = await Promise.all([listVisitsCovering(from, to).then(summarize), summarizeTrips(from.toISOString(), to.toISOString())]);
      const entries = [...visits.map((v) => ({ type: "visit" as const, at: v.arrivedAt, ...v })), ...trips.map((t) => ({ type: "trip" as const, at: t.departedAt, ...t }))];
      return textResult(entries.sort((a, b) => a.at.localeCompare(b.at)));
    }
  );
}
