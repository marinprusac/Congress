import type { ClassifyVisitRequest, PlaceSummary, PollHealth, TrackingSettings, Trip, Visit, VisitStatus } from "./types";

// The location connector (server: src/connectors/location/routes.ts).
const BASE = "/congress/connectors/location";

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
  return p.size ? `?${p}` : "";
};

export const fetchPlaces = () => send<PlaceSummary[]>("/places");
export const fetchVisits = (q: { status?: VisitStatus; from?: string; to?: string } = {}) => send<Visit[]>(`/visits${qs(q)}`);
export const fetchVisit = (id: number) => send<Visit>(`/visits/${id}`);
// Wherever the device was at an instant (null before any history).
export const fetchVisitActiveAt = (at: string) => send<Visit | null>(`/visits/active-at?at=${encodeURIComponent(at)}`);
// A visit a rebuild already replaced answers { gone: true }.
export const classifyVisit = (id: number, input: ClassifyVisitRequest) => send<Visit | { gone: true }>(`/visits/${id}/classify`, { method: "POST", body: JSON.stringify(input) });
export const fetchTrips = (q: { from?: string; to?: string } = {}) => send<Trip[]>(`/trips${qs(q)}`);

export interface LocationStatus {
  traccar: { url: string; deviceId: number } | null;
  poll: PollHealth;
  settings: TrackingSettings;
}
export const fetchLocationStatus = () => send<LocationStatus>("/status");
export const fetchPollHealth = async () => (await fetchLocationStatus()).poll;
export const saveTrackingSettings = (patch: Partial<TrackingSettings>) => send<TrackingSettings>("/settings", { method: "PUT", body: JSON.stringify(patch) });
export const saveTraccar = (input: { url: string; token: string; deviceId: number }) => send<{ ok: true }>("/traccar", { method: "PUT", body: JSON.stringify(input) });
export const rebuildHistory = () => send<{ visitsCreated: number; annotationsRestored: number; annotationsLost: number }>("/reprocess", { method: "POST", body: "{}" });
