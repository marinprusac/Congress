import type { TraccarPosition } from "./traccar/client.js";
import { haversineMeters } from "./geo.js";
import { listPlaces } from "./places.js";
import { getSettings } from "./settings.js";
import { publishEvent } from "./events.js";
import {
  getOpenVisit,
  openConfirmedVisit,
  openPendingVisit,
  closeVisit,
  markPendingNotified,
  createTrip,
  type VisitRow,
  type BufferedFix,
} from "./visits.js";

const KNOTS_TO_KMH = 1.852;

// Below this, an unmatched fix is treated as "stopped" and eligible to open
// or extend an unknown dwell; at or above it, the fix is just transit data.
// This - not distance-based clustering across consecutive fixes - is what
// keeps a normal drive between two known places from generating a flood of
// tiny "pending" visits at every unmatched ping along the route. Relies on
// Traccar Client actually reporting a plausible speed per fix; if a device's
// reporting mode never populates speed (rare, but possible depending on
// platform/config), this degrades back to "every unmatched fix is a
// candidate dwell" - an accepted, documented limitation rather than a
// silent one.
const STOPPED_SPEED_KMH = 3;

interface PlaceCandidate {
  id: number;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

function findMatchingPlace(fix: TraccarPosition, candidates: PlaceCandidate[]): PlaceCandidate | null {
  let best: { place: PlaceCandidate; distance: number } | null = null;
  for (const place of candidates) {
    const distance = haversineMeters(fix, place);
    if (distance <= place.radiusMeters && (!best || distance < best.distance)) {
      best = { place, distance };
    }
  }
  return best?.place ?? null;
}

// Raw fixes collected since the last visit closed - the only place raw
// coordinates live even transiently (see db/schema.ts's comment on why
// visits/trips, not positions, are the durable record). Module-level and
// restart-losing by design, same accepted gap as chamber-calendar's own
// in-memory "scheduled" map.
let inTransitBuffer: BufferedFix[] = [];

async function handleTransition(
  previous: VisitRow | null,
  next: VisitRow,
  atFixTime: Date,
  placeById: Map<number, PlaceCandidate>
): Promise<void> {
  if (previous) {
    closeVisit(previous.id, atFixTime);
    const trip = await createTrip(previous.id, next.id, previous.arrivedAt, atFixTime, inTransitBuffer);
    await publishEvent({
      type: "map.trip_completed",
      payload: {
        tripId: trip.id,
        fromPlace: trip.fromLabel,
        toPlace: trip.toLabel,
        distanceKm: trip.distanceKm,
        mode: trip.mode,
        durationMinutes: trip.durationMinutes,
      },
    });
    if (previous.placeId) {
      const place = placeById.get(previous.placeId);
      await publishEvent({
        type: "map.departed_place",
        payload: {
          visitId: previous.id,
          placeId: previous.placeId,
          placeName: place?.name ?? null,
          durationMinutes: Math.round((atFixTime.getTime() - previous.arrivedAt.getTime()) / 60000),
          at: atFixTime.toISOString(),
        },
      });
    }
  }
  inTransitBuffer = [];

  if (next.placeId) {
    const place = placeById.get(next.placeId);
    await publishEvent({
      type: "map.arrived_at_place",
      payload: {
        visitId: next.id,
        placeId: next.placeId,
        placeName: place?.name ?? null,
        category: place?.category ?? null,
        at: atFixTime.toISOString(),
      },
    });
  }
}

function maybeFlagPending(visit: VisitRow, latestFixTime: Date, minDwellMs: number): void {
  if (visit.status !== "pending" || visit.pendingNotifiedAt) return;
  if (latestFixTime.getTime() - visit.arrivedAt.getTime() < minDwellMs) return;
  markPendingNotified(visit.id, latestFixTime);
  visit.pendingNotifiedAt = latestFixTime; // avoid re-firing later in the same batch
  void publishEvent({
    type: "map.unclassified_dwell_pending",
    payload: {
      visitId: visit.id,
      clusterLatitude: visit.clusterLatitude,
      clusterLongitude: visit.clusterLongitude,
      dwellMinutes: Math.round((latestFixTime.getTime() - visit.arrivedAt.getTime()) / 60000),
    },
  });
}

// Processes one batch of Traccar fixes in ascending time order, mutating
// visits/trips as arrivals/departures are detected. Re-derives "where are we
// currently" fresh from the DB (getOpenVisit) rather than trusting in-memory
// state carried over from a previous call, so a Chamber restart never loses
// track of it - see poller.ts.
export async function processPositions(positions: TraccarPosition[]): Promise<void> {
  if (positions.length === 0) return;

  const [placeRows, settings] = await Promise.all([listPlaces(), getSettings()]);
  const candidates: PlaceCandidate[] = placeRows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    latitude: r.latitude,
    longitude: r.longitude,
    radiusMeters: r.radiusMeters,
  }));
  const placeById = new Map(candidates.map((p) => [p.id, p]));

  let openVisitRow = getOpenVisit();

  for (const fix of positions) {
    const fixTime = new Date(fix.fixTime);
    const matched = findMatchingPlace(fix, candidates);

    if (matched) {
      if (openVisitRow && openVisitRow.placeId === matched.id) continue; // still there
      const newVisit = openConfirmedVisit(matched.id, fixTime);
      await handleTransition(openVisitRow, newVisit, fixTime, placeById);
      openVisitRow = newVisit;
      continue;
    }

    const stillInUnknownCluster =
      !!openVisitRow &&
      openVisitRow.placeId === null &&
      openVisitRow.clusterLatitude !== null &&
      openVisitRow.clusterLongitude !== null &&
      haversineMeters(fix, { latitude: openVisitRow.clusterLatitude, longitude: openVisitRow.clusterLongitude }) <=
        settings.unknownClusterRadiusMeters;

    if (stillInUnknownCluster && openVisitRow) {
      maybeFlagPending(openVisitRow, fixTime, settings.minDwellMs);
      continue;
    }

    const speedKmh = fix.speed * KNOTS_TO_KMH;
    if (speedKmh < STOPPED_SPEED_KMH) {
      const newVisit = openPendingVisit(fix.latitude, fix.longitude, fixTime);
      await handleTransition(openVisitRow, newVisit, fixTime, placeById);
      openVisitRow = newVisit;
      continue;
    }

    inTransitBuffer.push({ latitude: fix.latitude, longitude: fix.longitude, speedKnots: fix.speed, fixTime });
  }
}
