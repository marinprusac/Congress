import type { TraccarPosition } from "./traccar/client.js";
import { haversineMeters } from "./geo.js";
import { listPlaces } from "./places.js";
import { getSettings } from "./settings.js";
import { publishEvent } from "./events.js";
import { recordPosition } from "./positions.js";
import {
  getOpenVisit,
  openConfirmedVisit,
  openPendingVisit,
  closeVisit,
  markPendingNotified,
  createTrip,
  createTripFixAccumulator,
  accumulateTripFix,
  type VisitRow,
  type TripFixAccumulator,
} from "./visits.js";

const KNOTS_TO_KMH = 1.852;

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

// Running distance/max-speed accumulator for fixes seen since the last
// visit closed - the only place raw coordinates even transiently factor in
// (see db/schema.ts's comment on why visits/trips, not positions, are the
// durable record). Module-level and restart-losing by design, same accepted
// gap as chamber-calendar's own in-memory "scheduled" map. O(1) regardless
// of how long a trip runs, unlike the raw-fix array this replaced.
let inTransitAcc: TripFixAccumulator = createTripFixAccumulator();

async function handleTransition(
  previous: VisitRow | null,
  next: VisitRow,
  atFixTime: Date,
  placeById: Map<number, PlaceCandidate>
): Promise<void> {
  if (previous) {
    // `previous` may already be closed - see the early-close-on-resumed-
    // movement branch in processPositions, which records a visit's true
    // departure time before its eventual trip destination is known. Use that
    // real timestamp for anything describing "when did previous end", not
    // atFixTime (which by now is when we reached `next`, possibly much
    // later - conflating the two would inflate a departed_place event's
    // reported dwell duration by however long the following trip took).
    const departedAt = previous.departedAt ?? atFixTime;
    if (previous.departedAt === null) closeVisit(previous.id, atFixTime);
    // A commute between two different known places names itself - only
    // a same-place round trip (previous.placeId === next.placeId, handled
    // below via needsLabel) is genuinely ambiguous enough to ask about.
    const autoLabel =
      previous.placeId !== null && next.placeId !== null && previous.placeId !== next.placeId
        ? `commute to ${placeById.get(next.placeId)?.name ?? "destination"}`
        : null;
    const trip = await createTrip(previous.id, next.id, previous.arrivedAt, atFixTime, inTransitAcc, autoLabel);
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
    // A round trip to the same known place with no dot recorded in between
    // (see visits.ts's toTrip needsLabel) - "Home -> Home" alone says
    // nothing about why, so ask the owner rather than leave it unexplained.
    if (trip.needsLabel) {
      await publishEvent({
        type: "map.trip_needs_label",
        payload: { tripId: trip.id, placeName: trip.fromLabel, durationMinutes: trip.durationMinutes },
      });
    }
    if (previous.placeId) {
      const place = placeById.get(previous.placeId);
      await publishEvent({
        type: "map.departed_place",
        payload: {
          visitId: previous.id,
          placeId: previous.placeId,
          placeName: place?.name ?? null,
          durationMinutes: Math.round((departedAt.getTime() - previous.arrivedAt.getTime()) / 60000),
          at: departedAt.toISOString(),
        },
      });
    }
  }
  inTransitAcc = createTripFixAccumulator();

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

// An unmatched, stopped fix seen since the last visit closed, not yet worth
// recording as a visit - see the dwell-threshold check in processPositions
// below. Never persisted: if movement resumes before minDwellMs, this whole
// stop silently folds into ordinary trip transit (a red light, a drive-thru
// queue), which is the point - a dot on the map should mean "stayed
// somewhere long enough to matter", not "any fix under stoppedSpeedKmh".
// Restart-losing, same accepted gap as inTransitAcc.
interface CandidateStop {
  latitude: number;
  longitude: number;
  firstFixTime: Date;
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
  // A pending visit already closed (see below) but not yet linked to an
  // outgoing trip, since its destination isn't known yet - handleTransition
  // creates that trip once the real next stop/place is found. At most one of
  // {openVisitRow, tripOrigin} is ever non-null. Restart-losing by design,
  // same accepted gap as inTransitAcc.
  let tripOrigin: VisitRow | null = null;
  let candidateStop: CandidateStop | null = null;

  for (const fix of positions) {
    recordPosition(fix); // permanent log - see positions.ts - independent of everything below
    const fixTime = new Date(fix.fixTime);
    const matched = findMatchingPlace(fix, candidates);

    if (matched) {
      if (openVisitRow && openVisitRow.placeId === matched.id) continue; // still there
      candidateStop = null; // didn't last - folds into this trip, no dot
      const newVisit = openConfirmedVisit(matched.id, fixTime);
      await handleTransition(openVisitRow ?? tripOrigin, newVisit, fixTime, placeById);
      tripOrigin = null;
      openVisitRow = newVisit;
      continue;
    }

    // Still inside an already-promoted (persisted) pending visit's cluster -
    // nothing more to do, its dwell notification already fired at promotion.
    if (
      openVisitRow &&
      openVisitRow.placeId === null &&
      openVisitRow.clusterLatitude !== null &&
      openVisitRow.clusterLongitude !== null &&
      haversineMeters(fix, { latitude: openVisitRow.clusterLatitude, longitude: openVisitRow.clusterLongitude }) <=
        settings.unknownClusterRadiusMeters
    ) {
      continue;
    }

    // Still inside a not-yet-promoted candidate stop's cluster - keep
    // buffering, and promote to a real visit once dwell crosses minDwellMs.
    // Below that: an unmatched fix is what makes a fix eligible to start or
    // extend a candidate at all. This - not distance-based clustering across
    // consecutive fixes - is what keeps a normal drive between two known
    // places from generating a flood of tiny dots at every unmatched ping
    // along the route. Relies on Traccar reporting a plausible speed per
    // fix; if a device's reporting mode never populates speed, this degrades
    // to "every unmatched fix is a candidate dwell start" - an accepted,
    // documented limitation. User-tunable (see Settings).
    if (candidateStop && haversineMeters(fix, candidateStop) <= settings.unknownClusterRadiusMeters) {
      accumulateTripFix(inTransitAcc, { latitude: fix.latitude, longitude: fix.longitude, speedKnots: fix.speed });
      const dwellMs = fixTime.getTime() - candidateStop.firstFixTime.getTime();
      if (dwellMs >= settings.minDwellMs) {
        const arrivedAt = candidateStop.firstFixTime;
        const newVisit = openPendingVisit(candidateStop.latitude, candidateStop.longitude, arrivedAt);
        await handleTransition(openVisitRow ?? tripOrigin, newVisit, arrivedAt, placeById);
        tripOrigin = null;
        openVisitRow = newVisit;
        candidateStop = null;
        markPendingNotified(newVisit.id, fixTime);
        await publishEvent({
          type: "map.unclassified_dwell_pending",
          payload: {
            visitId: newVisit.id,
            clusterLatitude: newVisit.clusterLatitude,
            clusterLongitude: newVisit.clusterLongitude,
            dwellMinutes: Math.round(dwellMs / 60000),
          },
        });
      }
      continue;
    }

    // Left whatever we were at - an unpromoted candidate that didn't last
    // (discarded, its time folds into ordinary trip transit - the "just
    // lines, no dots" case for a red light or drive-thru), a promoted dot
    // we've now moved away from, or a known place's own radius (this branch
    // only runs once `matched` above is already null, so a confirmed visit
    // here means we've left its radius too). Closing immediately - rather
    // than waiting for a match/promotion elsewhere the way the old lazy
    // behavior did - matters for two things: a promoted dot's cluster is
    // frozen at its first stopped fix, so leaving it open (and reported as
    // "current location" by getOpenVisit) for the rest of the trip would let
    // it swallow whatever real stop comes next; and a known place needs its
    // own accurate departure time so a same-place round trip that never
    // dwells anywhere else in between (drive-thru, quick errand) still
    // produces two visits and a real trip - see visits.ts's needsLabel -
    // instead of one visit silently spanning the whole outing.
    candidateStop = null;
    if (openVisitRow) {
      closeVisit(openVisitRow.id, fixTime);
      openVisitRow.departedAt = fixTime;
      tripOrigin = openVisitRow;
      openVisitRow = null;
    }

    const speedKmh = fix.speed * KNOTS_TO_KMH;
    if (speedKmh < settings.stoppedSpeedKmh) {
      candidateStop = { latitude: fix.latitude, longitude: fix.longitude, firstFixTime: fixTime };
    }

    accumulateTripFix(inTransitAcc, { latitude: fix.latitude, longitude: fix.longitude, speedKnots: fix.speed });
  }
}
