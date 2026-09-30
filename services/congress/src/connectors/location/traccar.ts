import type { TraccarConfig } from "./settings.js";

export class TraccarApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Traccar API error: ${status} ${body}`);
    this.name = "TraccarApiError";
    this.status = status;
  }
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  // Knots (Traccar's protocol convention).
  speed: number;
  fixTime: string;
  attributes: Record<string, unknown>;
}

// Well under a poll tick, so a hung Traccar costs one tick, not five minutes.
const TRACCAR_TIMEOUT_MS = 20_000;

// A device's positions from `since` to now, ascending by fix time.
export async function fetchPositionsSince(config: TraccarConfig, sinceIso: string, toIso = new Date().toISOString()): Promise<TraccarPosition[]> {
  const params = new URLSearchParams({ deviceId: String(config.deviceId), from: sinceIso, to: toIso });
  const res = await fetch(`${config.url}/api/positions?${params}`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TRACCAR_TIMEOUT_MS),
  });
  if (!res.ok) throw new TraccarApiError(res.status, await res.text());
  const positions = (await res.json()) as TraccarPosition[];
  return [...positions].sort((a, b) => a.fixTime.localeCompare(b.fixTime));
}
