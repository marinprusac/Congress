import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db/client.js";
import { positions } from "./db/schema.js";
import { haversineMeters } from "./geo.js";
import type { TraccarPosition } from "./traccar/client.js";

// Which of these Traccar position ids are already stored. Backs the poller's
// "don't classify the same fix twice" filter: the poll cursor is the last
// fix's own fixTime and Traccar's `from` is inclusive, so every tick refetches
// at least the boundary fix it already handled last time. Harmless for the
// `positions` table itself (onConflictDoNothing below), but not for
// tracking.ts, whose trip accumulator would append that same point again on
// every tick - once every pollIntervalMs for as long as the device stays
// silent, which on a phone that goes quiet for hours means a trip path padded
// with hundreds of copies of one coordinate. See poller.ts.
export function existingPositionIds(traccarIds: number[]): Set<number> {
  if (traccarIds.length === 0) return new Set();
  const rows = db
    .select({ traccarPositionId: positions.traccarPositionId })
    .from(positions)
    .where(inArray(positions.traccarPositionId, traccarIds))
    .all();
  return new Set(rows.map((r) => r.traccarPositionId));
}

// Appends one fix to the permanent GPS log - see db/schema.ts's comment on
// `positions`. Called unconditionally, once per fix, before any of
// tracking.ts's visit/trip classification runs, so nothing Traccar reports
// is ever silently dropped regardless of what that classification decides.
export function recordPosition(fix: TraccarPosition): void {
  db.insert(positions)
    .values({
      traccarPositionId: fix.id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      speedKnots: fix.speed,
      fixTime: new Date(fix.fixTime),
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
}

// Replays this table back into the shape tracking.ts consumes, so a
// historical range can be re-run through the exact same classification code
// path the live poller uses - see reprocess.ts. `attributes` is dropped on
// the way in (nothing downstream reads it) and comes back empty here.
// Ordered by fixTime then id so a reprocess is deterministic even where two
// fixes share a timestamp, which this device's data does contain.
export function listPositionsBetween(from: Date, to: Date): TraccarPosition[] {
  const rows = db
    .select()
    .from(positions)
    .where(and(gte(positions.fixTime, from), lte(positions.fixTime, to)))
    .orderBy(asc(positions.fixTime), asc(positions.id))
    .all();
  return rows.map((row) => ({
    id: row.traccarPositionId,
    deviceId: 0,
    latitude: row.latitude,
    longitude: row.longitude,
    speed: row.speedKnots,
    fixTime: row.fixTime.toISOString(),
    attributes: {},
  }));
}

const METERS_PER_DEGREE_LAT = 111_320;

// When the earliest fix inside a place's radius was - i.e. how far back a
// reprocess has to reach for that place to pick up every visit it should
// have matched. Null when this place was never visited in the window, which
// is what lets adding a place you've never been to skip reprocessing
// entirely. Prefilters on a lat/lon bounding box in SQL (there's no spatial
// index, but this keeps the rows haversine actually runs over small) and
// then measures precisely in JS, since the box's corners are outside the
// circle it encloses.
export function findEarliestFixNear(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  notBefore: Date
): Date | null {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.max(Math.cos((latitude * Math.PI) / 180), 1e-6));
  const rows = db
    .select()
    .from(positions)
    .where(
      and(
        gte(positions.fixTime, notBefore),
        gte(positions.latitude, latitude - latDelta),
        lte(positions.latitude, latitude + latDelta),
        gte(positions.longitude, longitude - lonDelta),
        lte(positions.longitude, longitude + lonDelta)
      )
    )
    .orderBy(asc(positions.fixTime))
    .all();
  for (const row of rows) {
    if (haversineMeters(row, { latitude, longitude }) <= radiusMeters) return row.fixTime;
  }
  return null;
}
