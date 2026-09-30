import { ConnectorRefusedError, defineConnector, type ConnectorContext, type RecordChange } from "../contract.js";
import { closeLocationDb, runLocationMigrations } from "./db/client.js";
import { setEventContext } from "./events.js";
import { listPlaces, removePlace, upsertPlace } from "./places.js";
import { startTracking, stopTracking } from "./poller.js";
import { healTrackingStateOnBoot, reprocessForPlace } from "./reprocess.js";
import { traccarConfig } from "./settings.js";
import { listVisits } from "./visits.js";
import { locationRoutes } from "./routes.js";
import { registerLocationTools } from "./tools.js";
import { mapFeed } from "./feed.js";
import { MAP_EVENTS } from "./mapEvents.js";
import { startOfDay, dayOf } from "../../typeEngine/zone.js";
import type { PlaceSummary } from "./types.js";

const refuse = () => Promise.reject(new ConnectorRefusedError("Location history is read-only"));
const DEFAULT_RADIUS_M = 100;

// A Place record as tracking reads it, or null while it lacks a position.
export function placeFromRecord(id: string, values: Record<string, unknown>): PlaceSummary | null {
  const lat = values.latitude;
  const lon = values.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const radius = typeof values.radius === "number" && values.radius > 0 ? values.radius : DEFAULT_RADIUS_M;
  return { id, name: String(values.name ?? "") || "Place", latitude: lat, longitude: lon, radiusMeters: Math.round(radius) };
}

// History is a rule-driven reading of the GPS log: a place that moved, appeared or went means rereading it.
function rebuildQuietly(...args: Parameters<typeof reprocessForPlace>): void {
  reprocessForPlace(...args).catch((err) => console.error("[location] history rebuild after a place change failed:", err));
}

// Brings the mirror in line with the Place records (at start: no rebuild, the boot heal covers the edge).
async function syncMirror(ctx: ConnectorContext): Promise<void> {
  const records = ctx.records.list("place");
  const seen = new Set<string>();
  for (const r of records) {
    const p = placeFromRecord(r.id, r.values);
    if (!p) continue;
    seen.add(p.id);
    upsertPlace(p);
  }
  for (const p of await listPlaces()) if (!seen.has(p.id)) removePlace(p.id);
}

function onPlaceChange(change: RecordChange): void {
  if (change.op === "delete") {
    const gone = removePlace(change.id);
    if (gone) rebuildQuietly(gone);
    return;
  }
  const place = change.values ? placeFromRecord(change.id, change.values) : null;
  if (!place) {
    const gone = removePlace(change.id);
    if (gone) rebuildQuietly(gone);
    return;
  }
  const { geometryChanged, previous } = upsertPlace(place);
  if (geometryChanged) rebuildQuietly(place, previous);
}

// Where the owner has been: Traccar's GPS log, the visits and trips read
// from it, and their classifications. Places are the owner's Place records.
export const locationConnector = defineConnector({
  name: "location",
  label: "Location",
  source: [],
  events: MAP_EVENTS,
  async start(ctx) {
    runLocationMigrations();
    setEventContext(ctx);
    await syncMirror(ctx);
    if (traccarConfig()) await healTrackingStateOnBoot();
    startTracking();
  },
  stop() {
    stopTracking();
    setEventContext(null);
    closeLocationDb();
  },
  // The poller keeps its own clock (the tracking interval setting).
  sync: async () => ({ changed: 0, error: null }),
  intervalMs: () => 24 * 3_600_000,
  read: { get: () => null, list: () => [] },
  push: { create: refuse, update: refuse, delete: refuse, act: refuse },
  routes: () => locationRoutes(),
  tools: (_ctx, server) => registerLocationTools(server),
  onRecordChange(_ctx, change) {
    if (change.type === "place") onPlaceChange(change);
  },
  // Only once it's tracking (the Map cutover gives it Traccar).
  async feed(now) {
    if (!traccarConfig()) return [];
    return mapFeed(await listVisits({ from: new Date(startOfDay(dayOf(now.getTime()))) }));
  },
});
