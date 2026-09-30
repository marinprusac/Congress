import type { Visit } from "./types";

// One marker per distinct place (or unplaced cluster), skipping ignored and location-less visits.
export function dayMarkers(visits: readonly (Visit | null | undefined)[]): Visit[] {
  const byKey = new Map<string, Visit>();
  for (const v of visits) {
    if (!v || v.status === "ignored" || v.latitude === null || v.longitude === null) continue;
    const key = v.placeId ? `place-${v.placeId}` : `visit-${v.id}`;
    if (!byKey.has(key)) byKey.set(key, v);
  }
  return [...byKey.values()];
}
