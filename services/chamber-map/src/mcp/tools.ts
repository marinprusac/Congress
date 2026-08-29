import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { listVisits, listTrips } from "../visits.js";

function toDateRange(from?: string, to?: string): { from?: Date; to?: Date } {
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
}

async function summarizeVisits(from?: string, to?: string) {
  const range = toDateRange(from, to);
  const visits = await listVisits({ ...range });
  return visits
    .filter((v) => v.status === "confirmed" || v.status === "adhoc")
    .map((v) => ({
      place: v.placeName ?? v.adhocLabel ?? "Unknown location",
      arrivedAt: v.arrivedAt,
      departedAt: v.departedAt,
      durationMinutes: v.durationMinutes,
    }));
}

async function summarizeTrips(from?: string, to?: string) {
  const range = toDateRange(from, to);
  const trips = await listTrips(range);
  return trips.map((t) => ({
    from: t.fromLabel,
    to: t.toLabel,
    label: t.label,
    departedAt: t.departedAt,
    arrivedAt: t.arrivedAt,
    durationMinutes: t.durationMinutes,
    distanceKm: Math.round(t.distanceKm * 10) / 10,
    mode: t.mode,
  }));
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_visits",
    {
      title: "List Visits",
      description:
        "List places visited in a date range (most recent first). Excludes visits still awaiting classification and ones the owner chose to ignore.",
      inputSchema: {
        from: z.string().datetime().optional().describe("ISO timestamp, inclusive lower bound on arrival time"),
        to: z.string().datetime().optional().describe("ISO timestamp, inclusive upper bound on arrival time"),
      },
    },
    async ({ from, to }) => textResult(await summarizeVisits(from, to))
  );

  server.registerTool(
    "list_trips",
    {
      title: "List Trips",
      description: "List trips (movement between two visits) in a date range, most recent first.",
      inputSchema: {
        from: z.string().datetime().optional().describe("ISO timestamp, inclusive lower bound on departure time"),
        to: z.string().datetime().optional().describe("ISO timestamp, inclusive upper bound on departure time"),
      },
    },
    async ({ from, to }) => textResult(await summarizeTrips(from, to))
  );

  server.registerTool(
    "get_day_summary",
    {
      title: "Get Day Summary",
      description: "Get a single day's visits and trips merged into one chronological feed - the most useful single call for a daily recap.",
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD") },
    },
    async ({ date }) => {
      const from = new Date(`${date}T00:00:00.000Z`).toISOString();
      const to = new Date(`${date}T23:59:59.999Z`).toISOString();
      const [visits, trips] = await Promise.all([summarizeVisits(from, to), summarizeTrips(from, to)]);

      const entries = [
        ...visits.map((v) => ({ type: "visit" as const, at: v.arrivedAt, ...v })),
        ...trips.map((t) => ({ type: "trip" as const, at: t.departedAt, ...t })),
      ].sort((a, b) => a.at.localeCompare(b.at));

      return textResult(entries);
    }
  );
}
