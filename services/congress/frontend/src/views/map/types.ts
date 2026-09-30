// The location connector's shapes (server: src/connectors/location/types.ts).

export type VisitStatus = "confirmed" | "pending" | "adhoc" | "ignored";
export type TripMode = "walk" | "bike" | "transit" | "unknown";

export interface PlaceSummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface Visit {
  id: number;
  placeId: string | null;
  placeName: string | null;
  status: VisitStatus;
  adhocLabel: string | null;
  clusterLatitude: number | null;
  clusterLongitude: number | null;
  latitude: number | null;
  longitude: number | null;
  arrivedAt: string;
  departedAt: string | null;
  durationMinutes: number | null;
}

export interface Trip {
  id: number;
  fromVisitId: number;
  toVisitId: number;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  fromLabel: string;
  toLabel: string;
  departedAt: string;
  arrivedAt: string;
  durationMinutes: number;
  distanceKm: number;
  mode: TripMode;
  path: { latitude: number; longitude: number }[] | null;
}

export interface PollHealth {
  lastProcessedAt: string | null;
  lastPollSucceededAt: string | null;
  lastPollError: string | null;
}

export interface TrackingSettings {
  unknownClusterRadiusMeters: number;
  minDwellMs: number;
  stoppedSpeedKmh: number;
  pollIntervalMs: number;
  staleThresholdMs: number;
}

export type ClassifyVisitRequest = { action: "assign_place"; placeId: string } | { action: "adhoc_label"; label: string } | { action: "ignore" };
