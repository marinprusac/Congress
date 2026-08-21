import type {
  PlaceSummary,
  PlaceDetail,
  CreatePlaceRequest,
  UpdatePlaceRequest,
  Visit,
  VisitStatus,
  ClassifyVisitRequest,
  Trip,
  Settings,
  UpdateSettingsRequest,
  PollHealth,
} from "../../../src/types";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("map", import.meta.env.PROD);

// --- Places ---

export function fetchPlaces(): Promise<PlaceSummary[]> {
  return fetch(`${API_BASE}/places`).then((res) => json(res));
}

export function fetchRecentPlaces(): Promise<PlaceSummary[]> {
  return fetch(`${API_BASE}/places/recent`).then((res) => json(res));
}

export function searchPlaces(query: string): Promise<PlaceSummary[]> {
  return fetch(`${API_BASE}/places/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchPlace(id: number): Promise<PlaceDetail> {
  return fetch(`${API_BASE}/places/${id}`).then((res) => json(res));
}

export function createPlace(input: CreatePlaceRequest): Promise<PlaceDetail> {
  return fetch(`${API_BASE}/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updatePlace(id: number, input: UpdatePlaceRequest): Promise<PlaceDetail> {
  return fetch(`${API_BASE}/places/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deletePlace(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/places/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete place");
}

// Quick-create a place from a "[[" picker or the References panel's "+
// Create" option - mirrors every other Chamber's frontend/src/lib/api.ts's
// own quickCreate<Entity>Exhibit. Defaults to a 0,0/100m placeholder
// geofence since the picker's title-only prompt has no coordinates to give -
// the owner is expected to open the new place and set its location for real.
export async function quickCreatePlaceExhibit(title: string): Promise<CapitolExhibitSearchResult> {
  const place = await createPlace({ name: title, body: "", category: "place", latitude: 0, longitude: 0, radiusMeters: 100 });
  return { chamber: "map", id: `place-${place.id}`, type: "place", name: place.name, url: `/p/${place.id}` };
}

// --- Visits ---

export interface VisitsQuery {
  status?: VisitStatus;
  from?: string;
  to?: string;
}

function toQueryString(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchVisits(query: VisitsQuery = {}): Promise<Visit[]> {
  return fetch(`${API_BASE}/visits${toQueryString({ ...query })}`).then((res) => json(res));
}

export function fetchVisit(id: number): Promise<Visit> {
  return fetch(`${API_BASE}/visits/${id}`).then((res) => json(res));
}

export function classifyVisit(id: number, input: ClassifyVisitRequest): Promise<Visit> {
  return fetch(`${API_BASE}/visits/${id}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

// --- Trips ---

export function fetchTrips(query: { from?: string; to?: string } = {}): Promise<Trip[]> {
  return fetch(`${API_BASE}/trips${toQueryString(query)}`).then((res) => json(res));
}

// --- Settings & poll health ---

export function fetchSettings(): Promise<Settings> {
  return fetch(`${API_BASE}/settings`).then((res) => json(res));
}

export function updateSettings(input: UpdateSettingsRequest): Promise<Settings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchPollHealth(): Promise<PollHealth> {
  return fetch(`${API_BASE}/poll-health`).then((res) => json(res));
}
