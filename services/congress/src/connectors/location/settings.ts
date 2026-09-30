import { eq } from "drizzle-orm";
import { locationDb as db } from "./db/client.js";
import { settings } from "./db/schema.js";
import type { Settings } from "./types.js";

type Row = typeof settings.$inferSelect;

const DEFAULTS = {
  unknownClusterRadiusMeters: 150,
  minDwellMs: 15 * 60 * 1000,
  stoppedSpeedKmh: 3,
  pollIntervalMs: 2 * 60 * 1000,
  staleThresholdMs: 12 * 60 * 60 * 1000,
};

function row(): Row | undefined {
  return db.select().from(settings).where(eq(settings.id, 1)).get();
}

// The tracking tunables (what the Map Chamber called its settings).
export async function getSettings(): Promise<Settings> {
  const r = row();
  return r
    ? {
        unknownClusterRadiusMeters: r.unknownClusterRadiusMeters,
        minDwellMs: r.minDwellMs,
        stoppedSpeedKmh: r.stoppedSpeedKmh,
        pollIntervalMs: r.pollIntervalMs,
        staleThresholdMs: r.staleThresholdMs,
      }
    : { ...DEFAULTS };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  writeRow(patch);
  return getSettings();
}

export function writeRow(patch: Partial<Omit<Row, "id">>): void {
  if (row()) db.update(settings).set(patch).where(eq(settings.id, 1)).run();
  else db.insert(settings).values({ id: 1, ...patch }).run();
}

export interface TraccarConfig {
  url: string;
  token: string;
  deviceId: number;
}

// Null until the owner (or the Map cutover) sets it: the connector stays idle.
export function traccarConfig(): TraccarConfig | null {
  const r = row();
  return r?.traccarUrl && r.traccarToken && r.traccarDeviceId ? { url: r.traccarUrl, token: r.traccarToken, deviceId: r.traccarDeviceId } : null;
}
