import { env } from "../env.js";

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
  // Traccar reports speed in knots (protocol convention, not km/h) - see
  // tracking.ts's guessTripMode for the conversion.
  speed: number;
  fixTime: string;
  attributes: Record<string, unknown>;
}

// Bare fetch() falls back to undici's 300s header timeout, which is more
// than two orders of magnitude longer than a poll tick - a Traccar that
// accepts the connection and then never answers (the container wedged, a
// reverse proxy holding the socket open) would stall the whole poll loop for
// five minutes per tick rather than failing fast and retrying on the next
// one. Bounded well under the shortest sensible poll interval instead, so a
// hung request costs at most one tick.
const TRACCAR_TIMEOUT_MS = 20_000;

async function traccarFetch(path: string): Promise<unknown> {
  const res = await fetch(`${env.TRACCAR_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${env.TRACCAR_TOKEN}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TRACCAR_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new TraccarApiError(res.status, await res.text());
  }
  return res.json();
}

// Historical (not just latest) positions for a device, ascending by fixTime -
// Traccar's own /positions endpoint accepts deviceId+from+to for a range on
// top of its no-params "latest per device" mode. `to` defaults to now.
// Verify the exact query param names against the live server's own
// /api-docs during initial integration - this is drawn from Traccar's public
// openapi.yaml, not from a running instance.
export async function fetchPositionsSince(deviceId: number, sinceIso: string, toIso = new Date().toISOString()): Promise<TraccarPosition[]> {
  const params = new URLSearchParams({ deviceId: String(deviceId), from: sinceIso, to: toIso });
  const positions = (await traccarFetch(`/api/positions?${params}`)) as TraccarPosition[];
  return [...positions].sort((a, b) => a.fixTime.localeCompare(b.fixTime));
}
