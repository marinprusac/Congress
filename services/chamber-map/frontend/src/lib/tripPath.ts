import type { Trip, Visit } from "../../../src/types";

// The polyline to draw for a trip, or null when there's genuinely nothing
// to draw.
//
// `path` is the real sequence of fixes recorded in transit, and it already
// carries both endpoints (createTrip anchors it with the two visits' own
// coordinates), so it stands on its own. That matters more than it looks:
// a trip crossing midnight has at least one endpoint visit outside the day
// being viewed, and therefore missing from `visitsById` - insisting on
// those visits is what used to make such a trip silently draw nothing.
//
// The visit lookup survives only as the fallback for a trip with no stored
// path at all (one predating path storage, or a restart that lost the
// in-memory accumulator mid-trip), where a straight line between the two
// ends really is everything that's known.
export function tripPositions(trip: Trip, visitsById: Map<number, Visit>): [number, number][] | null {
  if (trip.path && trip.path.length > 0) {
    return trip.path.map((p): [number, number] => [p.latitude, p.longitude]);
  }
  const from = visitsById.get(trip.fromVisitId);
  const to = visitsById.get(trip.toVisitId);
  if (!from || !to || from.latitude === null || to.latitude === null) return null;
  return [
    [from.latitude, from.longitude!],
    [to.latitude, to.longitude!],
  ];
}
