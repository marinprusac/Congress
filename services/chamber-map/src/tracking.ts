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

// How far outside its cluster the device may reappear, as a multiple of
// unknownClusterRadiusMeters, for a silent stretch to still count as time
// spent at the stop it followed rather than as travel - see the
// candidate-stop branch at the end of processPositions.
const GAP_CREDIT_DRIFT_FACTOR = 3;

interface CandidateStop {
  latitude: number;
  longitude: number;
  firstFixTime: Date;
}

interface PlaceCandidate {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

function visitLatLng(visit: VisitRow, placeById: Map<number, PlaceCandidate>): { latitude: number; longitude: number } | null {
  if (visit.placeId !== null) {
    const place = placeById.get(visit.placeId);
    return place ? { latitude: place.latitude, longitude: place.longitude } : null;
  }
  return visit.clusterLatitude !== null && visit.clusterLongitude !== null
    ? { latitude: visit.clusterLatitude, longitude: visit.clusterLongitude }
    : null;
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

// An unmatched, stopped fix seen since the last visit closed, not yet worth
// recording as a visit - see the dwell-threshold check in processPositions
// below. Never persisted: if movement resumes before minDwellMs, this whole
// stop silently folds into ordinary trip transit (a red light, a drive-thru
// queue), which is the point - a dot on the map should mean "stayed
// somewhere long enough to matter", not "any fix under stoppedSpeedKmh".
// Module-level and restart-losing, same accepted gap as inTransitAcc above -
// it has to be, since dwell time is only ever accumulated across separate
// poll ticks (each carrying just the handful of fixes seen since the last
// one), never within a single processPositions call.
let candidateStop: CandidateStop | null = null;

// A pending visit already closed (see the "left whatever we were at" branch
// in processPositions) but not yet linked to an outgoing trip, since its
// destination isn't known yet - handleTransition creates that trip once the
// real next stop/place is found, which (like candidateStop's promotion
// above) can easily land in a later poll tick than the one that closed this
// origin. At most one of {openVisitRow, tripOrigin} is ever non-null.
// Module-level and restart-losing, same accepted gap as inTransitAcc.
let tripOrigin: VisitRow | null = null;

// The previous fix, kept to derive speed from displacement over time rather
// than trusting the device's own instantaneous speed field - see
// stoppedSpeedKmhFor below.
let prevFix: { latitude: number; longitude: number; fixTime: Date } | null = null;

// Drops every scrap of in-memory carry-over between fixes, so a historical
// replay starts from the same blank slate a fresh boot would rather than
// inheriting wherever the live poller happened to be - see reprocess.ts.
// The DB-backed half of "where are we now" needs no reset: processPositions
// re-reads it via getOpenVisit on every call.
export function resetTrackingState(): void {
  inTransitAcc = createTripFixAccumulator();
  candidateStop = null;
  tripOrigin = null;
  prevFix = null;
}

// Serializes everything that touches the module state above. A poll tick
// and a reprocess are both async and both await mid-way through, so without
// this a tick landing inside a replay would interleave its own fixes into
// the replay's carry-over state (and write visits into a range the replay is
// concurrently deleting). Runs the next job regardless of whether the
// previous one threw, so one failure can't wedge the queue.
let trackingLock: Promise<unknown> = Promise.resolve();
export function withTrackingLock<T>(job: () => Promise<T>): Promise<T> {
  const run = trackingLock.then(job, job);
  trackingLock = run.catch(() => undefined);
  return run;
}

// How fast the device was actually moving, measured as displacement since
// the previous fix rather than read off that fix's own speed field. The
// device's instantaneous speed is a momentary sample - stand in a shop and
// walk a few steps between aisles and it happily reports 3-7 km/h, which is
// enough to look like travel even though net displacement over those
// minutes is a few dozen metres. Integrating over the gap instead is what
// lets "walked around inside one place" read as the stop it actually was.
// Falls back to the reported speed when there's nothing to measure against:
// the first fix after a (re)start, and the duplicate/out-of-order timestamps
// this device's own history does contain, where elapsed time is <= 0.
function movementSpeedKmh(fix: TraccarPosition, fixTime: Date): number {
  const reported = fix.speed * KNOTS_TO_KMH;
  if (!prevFix) return reported;
  const elapsedMs = fixTime.getTime() - prevFix.fixTime.getTime();
  if (elapsedMs <= 0) return reported;
  return haversineMeters(prevFix, fix) / 1000 / (elapsedMs / 3_600_000);
}

// A historical replay (reprocess.ts) re-runs arrivals and departures that
// already happened - relaying those would notify the owner all over again
// about a trip they took last week, so a replay swaps this for a no-op.
// Threaded through as a parameter rather than read off a module-level flag
// because a live poll tick can interleave with a reprocess mid-await, and a
// shared flag would leak one call's suppression into the other's events.
type Emit = (event: Parameters<typeof publishEvent>[0]) => Promise<unknown>;
const noopEmit: Emit = async () => {};
function emitterFor(publishEvents: boolean): Emit {
  return publishEvents ? publishEvent : noopEmit;
}

async function handleTransition(
  previous: VisitRow | null,
  next: VisitRow,
  atFixTime: Date,
  placeById: Map<number, PlaceCandidate>,
  publishEvents: boolean
): Promise<void> {
  const emit = emitterFor(publishEvents);
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
    // The two visits' own locations - see createTrip's own comment for what
    // these back (the flight heuristic's distance signal, a distanceKm
    // fallback, and the path's anchors). Null when a location can't be
    // resolved (shouldn't normally happen, but a missing place mid-trip
    // shouldn't crash tracking over a cosmetic distance/path figure).
    const fromLatLng = visitLatLng(previous, placeById);
    const toLatLng = visitLatLng(next, placeById);
    const trip = await createTrip(previous.id, next.id, departedAt, atFixTime, inTransitAcc, fromLatLng, toLatLng);
    await emit({
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
      await emit({
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
    await emit({
      type: "map.arrived_at_place",
      payload: {
        visitId: next.id,
        placeId: next.placeId,
        placeName: place?.name ?? null,
        at: atFixTime.toISOString(),
      },
    });
  }
}

// Processes one batch of Traccar fixes in ascending time order, mutating
// visits/trips as arrivals/departures are detected. Re-derives "where are we
// currently" fresh from the DB (getOpenVisit) rather than trusting in-memory
// state carried over from a previous call, so a Chamber restart never loses
// track of it - see poller.ts.
export interface ProcessPositionsOptions {
  // False when replaying history, so an arrival/departure that already
  // happened isn't relayed to the Logs/Automation Chambers a second time -
  // see emitterFor above.
  publishEvents?: boolean;
}

export async function processPositions(
  positions: TraccarPosition[],
  options: ProcessPositionsOptions = {}
): Promise<void> {
  if (positions.length === 0) return;
  const publishEvents = options.publishEvents ?? true;
  const emit = emitterFor(publishEvents);

  const [placeRows, settings] = await Promise.all([listPlaces(), getSettings()]);
  const candidates: PlaceCandidate[] = placeRows.map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    radiusMeters: r.radiusMeters,
  }));
  const placeById = new Map(candidates.map((p) => [p.id, p]));

  let openVisitRow = getOpenVisit();

  for (const fix of positions) {
    recordPosition(fix); // permanent log - see positions.ts - independent of everything below
    const fixTime = new Date(fix.fixTime);
    // Measured against the previous fix, then advanced right away so every
    // path out of this iteration - including the several `continue`s below -
    // leaves it correct for the next one.
    const speedKmh = movementSpeedKmh(fix, fixTime);
    prevFix = { latitude: fix.latitude, longitude: fix.longitude, fixTime };
    const matched = findMatchingPlace(fix, candidates);

    if (matched) {
      if (openVisitRow && openVisitRow.placeId === matched.id) continue; // still there
      candidateStop = null; // didn't last - folds into this trip, no dot
      const newVisit = openConfirmedVisit(matched.id, fixTime);
      await handleTransition(openVisitRow ?? tripOrigin, newVisit, fixTime, placeById, publishEvents);
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
        await handleTransition(openVisitRow ?? tripOrigin, newVisit, arrivedAt, placeById, publishEvents);
        tripOrigin = null;
        openVisitRow = newVisit;
        candidateStop = null;
        markPendingNotified(newVisit.id, fixTime);
        await emit({
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
    // produces two visits and a real trip, instead of one visit silently
    // spanning the whole outing.
    // (openVisitRow and candidateStop are never both non-null at once - the
    // moment either one is set, the other has already been cleared - so
    // this is genuinely either/or, not two independent checks.)
    if (candidateStop) {
      // The device went quiet right after a stopped fix and only reappears
      // now, outside the cluster. Where it reappears is what says whether
      // that silence was spent standing still or moving: drift back into
      // view a couple of hundred metres away and the gap was almost
      // certainly spent at the stop, with indoor GPS simply failing to file
      // the "still here" pings that would have extended the cluster above
      // (a shop, a terminal). Reappear kilometres away and the same silence
      // covered a journey - crediting that to the stop would invent a long
      // dwell out of a flight or a train ride, and there's no way to tell
      // from the fixes alone when within it they actually left, so the honest
      // reading is to end the stay at the last evidence of it and let the
      // gap fall to the trip. Closed immediately rather than left open the
      // way the in-cluster promotion above does, since reaching this branch
      // already means they'd gone by the time this fix arrived.
      const dwellMs = fixTime.getTime() - candidateStop.firstFixTime.getTime();
      const driftMeters = haversineMeters(fix, candidateStop);
      const stayedPut = driftMeters <= settings.unknownClusterRadiusMeters * GAP_CREDIT_DRIFT_FACTOR;
      if (stayedPut && dwellMs >= settings.minDwellMs) {
        const arrivedAt = candidateStop.firstFixTime;
        const newVisit = openPendingVisit(candidateStop.latitude, candidateStop.longitude, arrivedAt);
        await handleTransition(openVisitRow ?? tripOrigin, newVisit, arrivedAt, placeById, publishEvents);
        closeVisit(newVisit.id, fixTime);
        newVisit.departedAt = fixTime;
        tripOrigin = newVisit;
        markPendingNotified(newVisit.id, fixTime);
        await emit({
          type: "map.unclassified_dwell_pending",
          payload: {
            visitId: newVisit.id,
            clusterLatitude: newVisit.clusterLatitude,
            clusterLongitude: newVisit.clusterLongitude,
            dwellMinutes: Math.round(dwellMs / 60000),
          },
        });
      }
      candidateStop = null;
    } else if (openVisitRow) {
      closeVisit(openVisitRow.id, fixTime);
      openVisitRow.departedAt = fixTime;
      tripOrigin = openVisitRow;
      openVisitRow = null;
    }

    if (speedKmh < settings.stoppedSpeedKmh) {
      candidateStop = { latitude: fix.latitude, longitude: fix.longitude, firstFixTime: fixTime };
    }

    accumulateTripFix(inTransitAcc, { latitude: fix.latitude, longitude: fix.longitude, speedKnots: fix.speed });
  }
}
