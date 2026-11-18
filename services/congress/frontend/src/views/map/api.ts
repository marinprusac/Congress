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

// Wherever the device was at an instant (null before any history).
export const fetchVisitActiveAt = (at: string) => send<Visit | null>(`/visits/active-at?at=${encodeURIComponent(at)}`);
// A visit a rebuild already replaced answers { gone: true }.

export interface LocationStatus {
  traccar: { url: string; deviceId: number } | null;
  poll: PollHealth;
  settings: TrackingSettings;
}
export const fetchLocationStatus = () => send<LocationStatus>("/status");
export const saveTrackingSettings = (patch: Partial<TrackingSettings>) => send<TrackingSettings>("/settings", { method: "PUT", body: JSON.stringify(patch) });
export const saveTraccar = (input: { url: string; token: string; deviceId: number }) => send<{ ok: true }>("/traccar", { method: "PUT", body: JSON.stringify(input) });
export const rebuildHistory = () => send<{ visitsCreated: number; annotationsRestored: number; annotationsLost: number }>("/reprocess", { method: "POST", body: "{}" });
