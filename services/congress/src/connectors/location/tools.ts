import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "../../kit/mcp.js";
import { classifyVisit, getVisit, listVisits, listVisitsCovering, listTrips } from "./visits.js";
import { getPlace } from "./places.js";
import { listPositionsBetween } from "./positions.js";
import { isReviewed, visitContext } from "./review.js";
import type { Trip, Visit } from "./types.js";
import { startOfDay, endOfDay } from "../../typeEngine/zone.js";

// The AI's read of the owner's movements (the Places themselves are the generic *_place tools),
// and its one write: sorting out stops tracking couldn't place. Coordinates come back so a reply can draw them as a map block.

const range = (from?: string, to?: string) => ({ from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });

function summarize(visits: Visit[]) {
  return visits
    .filter((v) => v.status === "confirmed" || v.status === "adhoc")
    .map((v) => ({ place: v.placeName ?? v.adhocLabel ?? "Unknown location", placeId: v.placeId, latitude: v.latitude, longitude: v.longitude, arrivedAt: v.arrivedAt, departedAt: v.departedAt, durationMinutes: v.durationMinutes }));
}

const MAX_PATH_POINTS = 60;

// [lat, lng] pairs, thinned evenly (ends kept) so a long trip stays small.
export function thinPath(path: Trip["path"], max = MAX_PATH_POINTS): [number, number][] | null {
  if (!path?.length) return null;
  const step = Math.max(1, Math.ceil(path.length / max));
  const out = path.filter((_, i) => i % step === 0 || i === path.length - 1).map((p) => [round(p.latitude, 5), round(p.longitude, 5)] as [number, number]);
  return out;
}
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

async function summarizeTrips(from?: string, to?: string, includePath = false) {
  return (await listTrips(range(from, to))).map((t) => ({
    from: t.fromLabel,
    to: t.toLabel,
    departedAt: t.departedAt,
    arrivedAt: t.arrivedAt,
    durationMinutes: t.durationMinutes,
    distanceKm: Math.round(t.distanceKm * 10) / 10,
    mode: t.mode,
    ...(includePath ? { path: thinPath(t.path) } : {}),
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
        includePath: z.boolean().default(false).describe("Add each trip's route as [lat, lng] points (thinned), to draw on a map block"),
      },
    },
    async ({ from, to, includePath }) => textResult(await summarizeTrips(from, to, includePath))
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

  server.registerTool(
    "location_current",
    {
      title: "Current location",
      description: "The owner's latest known position (from the last 6 hours of GPS fixes), or null when there is none. Draw it with a map block.",
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      const last = listPositionsBetween(new Date(now.getTime() - 6 * 60 * 60 * 1000), now).at(-1);
      return textResult(last ? { latitude: last.latitude, longitude: last.longitude, at: last.fixTime, speedKmh: Math.round(last.speed * 1.852) } : null);
    }
  );

  server.registerTool(
    "location_pending_visits",
    {
      title: "Stops awaiting a place",
      description:
        "Recent stops (dwells) at spots that match none of the owner's Places, newest first, each with the nearest Places (distance, radius), labels given to earlier stops at the same spot, and whether you already reviewed it. Sort them out with location_classify_visit.",
      inputSchema: { limit: z.number().int().min(1).max(20).default(10) },
    },
    async ({ limit }) => {
      const pending = await listVisits({ status: "pending", limit });
      return textResult(await Promise.all(pending.map(async (v) => ({ ...(await visitContext(v)), reviewed: isReviewed(v) }))));
    }
  );

  server.registerTool(
    "location_classify_visit",
    {
      title: "Classify a stop",
      description:
        'Say what a pending stop was: "place" assigns one of the owner\'s existing Places (placeId), "label" names it without making a Place (a one-off spot: label), "ignore" drops it (nothing there worth recording). For a spot the owner will return to, create a Place record instead (create_place with the stop\'s coordinates): history rebuilds and confirms the stop itself.',
      inputSchema: {
        visitId: z.number().int(),
        action: z.enum(["place", "label", "ignore"]),
        placeId: z.string().optional().describe('For "place": a Place record id'),
        label: z.string().min(1).max(120).optional().describe('For "label"'),
      },
    },
    async ({ visitId, action, placeId, label }) => {
      const visit = await getVisit(visitId);
      if (!visit) return textResult({ error: "not_found", message: "No such stop - a history rebuild may have replaced it (check location_pending_visits)." });
      if (visit.status !== "pending") return textResult({ error: "not_pending", message: `That stop is already ${visit.status}.` });
      if (action === "place") {
        if (!placeId || !getPlace(placeId)) return textResult({ error: "invalid", message: "placeId must be an existing Place record." });
        return textResult(await classifyVisit(visitId, { action: "assign_place", placeId }));
      }
      if (action === "label") {
        if (!label) return textResult({ error: "invalid", message: "label is required." });
        return textResult(await classifyVisit(visitId, { action: "adhoc_label", label }));
      }
      return textResult(await classifyVisit(visitId, { action: "ignore" }));
    }
  );
}
