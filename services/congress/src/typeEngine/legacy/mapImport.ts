import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq, like } from "drizzle-orm";
import { db } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { readChamberEnv } from "../../chambers/loader.js";
import { forgetChamber } from "../../registry.js";
import { exhibitsDb, exhibitsSqlite } from "../db/client.js";
import { imports, recordRefs } from "../db/schema.js";
import { getTypeByPremadeKey } from "../store.js";
import { createRecord, syncRecordExhibit } from "../records.js";
import { addLegacyAlias, aliasesForIds } from "../aliases.js";
import { ulid } from "../ulid.js";
import { locationDb } from "../../connectors/location/db/client.js";
import { positions, settings, trips, visits } from "../../connectors/location/db/schema.js";
import { upsertPlace } from "../../connectors/location/places.js";

// One-time cutover of the Map Chamber: its places become Place records, its
// GPS log, visits (with the owner's labels) and trips move into the location
// connector, and Traccar with them. Read-only on its DB. Delete once it has run.

const KEY = "map-v1";
const CHAMBER = "map";
const MAP_DIR = fileURLToPath(new URL("../../../../chamber-map", import.meta.url));

export function mapChamberSource(): { dbPath: string; env: Record<string, string> } {
  const env = readChamberEnv(MAP_DIR);
  const configured = env.DB_PATH ?? "./data/map.sqlite3";
  return { dbPath: isAbsolute(configured) ? configured : resolve(MAP_DIR, configured), env };
}

export interface MapImportStats {
  skipped?: "already_ran" | "no_source" | "no_type" | "connector_has_data";
  places: number;
  refs: number;
  refsMissing: number;
  exhibitRefsRewritten: number;
  positions: number;
  visits: number;
  visitsUnplaced: number;
  trips: number;
  traccar: boolean;
}

type PlaceRow = { id: number; name: string; body: string; latitude: number; longitude: number; radius_meters: number; created_at: number; updated_at: number };
type VisitRow = {
  id: number;
  place_id: number | null;
  status: "confirmed" | "pending" | "adhoc" | "ignored";
  adhoc_label: string | null;
  cluster_latitude: number | null;
  cluster_longitude: number | null;
  arrived_at: number;
  departed_at: number | null;
  pending_notified_at: number | null;
  created_at: number;
  updated_at: number;
};

export function importLegacyMap(opts: { from?: string; env?: Record<string, string> } = {}): MapImportStats {
  const stats: MapImportStats = { places: 0, refs: 0, refsMissing: 0, exhibitRefsRewritten: 0, positions: 0, visits: 0, visitsUnplaced: 0, trips: 0, traccar: false };
  if (exhibitsDb.select().from(imports).where(eq(imports.key, KEY)).get()) return { ...stats, skipped: "already_ran" };
  const source = mapChamberSource();
  const from = opts.from ?? source.dbPath;
  const env = opts.env ?? source.env;
  if (!existsSync(from)) return { ...stats, skipped: "no_source" };
  const placeType = getTypeByPremadeKey("place");
  if (!placeType) return { ...stats, skipped: "no_type" };
  // The connector sat idle until now; anything in it would be overwritten.
  if (locationDb.select().from(visits).limit(1).get()) return { ...stats, skipped: "connector_has_data" };

  const map = new Database(from, { readonly: true, fileMustExist: true });
  const places = map.prepare("SELECT * FROM places ORDER BY id").all() as PlaceRow[];
  const refs = map.prepare("SELECT place_id, target_exhibit_id FROM place_refs ORDER BY id").all() as { place_id: number; target_exhibit_id: string }[];
  const fixes = map.prepare("SELECT * FROM positions ORDER BY id").all() as { traccar_position_id: number; latitude: number; longitude: number; speed_knots: number; fix_time: number; created_at: number }[];
  const visitRows = map.prepare("SELECT * FROM visits ORDER BY id").all() as VisitRow[];
  const tripRows = map.prepare("SELECT * FROM trips ORDER BY id").all() as {
    id: number;
    from_visit_id: number;
    to_visit_id: number;
    departed_at: number;
    arrived_at: number;
    distance_km: number;
    mode: "walk" | "bike" | "transit" | "unknown";
    path: string | null;
    created_at: number;
  }[];
  const tunables = map.prepare("SELECT * FROM settings WHERE id = 1").get() as Record<string, number | null> | undefined;
  map.close();

  // 1. Places become Place records (the connector's log is still empty, so no rebuild runs).
  const idFor = new Map<number, string>();
  for (const p of places) {
    const id = ulid(p.created_at);
    createRecord(
      "place",
      { name: p.name, notes: p.body, latitude: p.latitude, longitude: p.longitude, radius: p.radius_meters },
      { id, at: new Date(p.created_at), updatedAt: new Date(p.updated_at), quiet: true, actor: "import" }
    );
    idFor.set(p.id, id);
    // Also straight into the connector's mirror, whether or not it's running yet.
    upsertPlace({ id, name: p.name, latitude: p.latitude, longitude: p.longitude, radiusMeters: p.radius_meters });
    stats.places++;
  }
  exhibitsSqlite.transaction(() => {
    for (const [old, id] of idFor) addLegacyAlias(CHAMBER, `place-${old}`, id);
    for (const ref of refs) {
      const recordId = idFor.get(ref.place_id);
      if (!recordId) {
        stats.refsMissing++;
        continue;
      }
      const target = aliasesForIds([ref.target_exhibit_id]).get(ref.target_exhibit_id) ?? ref.target_exhibit_id;
      exhibitsDb.insert(recordRefs).values({ recordId, targetExhibitId: target, createdAt: new Date() }).onConflictDoNothing().run();
      stats.refs++;
    }
  })();

  // 2. The GPS log, visits (ids kept: trips point at them) and trips, in the connector.
  locationDb.transaction((tx) => {
    for (const f of fixes) {
      tx.insert(positions)
        .values({ traccarPositionId: f.traccar_position_id, latitude: f.latitude, longitude: f.longitude, speedKnots: f.speed_knots, fixTime: new Date(f.fix_time), createdAt: new Date(f.created_at) })
        .onConflictDoNothing()
        .run();
      stats.positions++;
    }
    for (const v of visitRows) {
      const placeId = v.place_id === null ? null : (idFor.get(v.place_id) ?? null);
      if (v.place_id !== null && !placeId) stats.visitsUnplaced++;
      tx.insert(visits)
        .values({
          id: v.id,
          placeId,
          status: v.status,
          adhocLabel: v.adhoc_label,
          clusterLatitude: v.cluster_latitude,
          clusterLongitude: v.cluster_longitude,
          arrivedAt: new Date(v.arrived_at),
          departedAt: v.departed_at === null ? null : new Date(v.departed_at),
          pendingNotifiedAt: v.pending_notified_at === null ? null : new Date(v.pending_notified_at),
          createdAt: new Date(v.created_at),
          updatedAt: new Date(v.updated_at),
        })
        .run();
      stats.visits++;
    }
    for (const t of tripRows) {
      tx.insert(trips)
        .values({
          id: t.id,
          fromVisitId: t.from_visit_id,
          toVisitId: t.to_visit_id,
          departedAt: new Date(t.departed_at),
          arrivedAt: new Date(t.arrived_at),
          distanceKm: t.distance_km,
          mode: t.mode,
          path: t.path,
          createdAt: new Date(t.created_at),
        })
        .run();
      stats.trips++;
    }
    // 3. Tunables, the poll cursor and Traccar: tracking resumes where the Chamber stopped.
    const deviceId = Number(env.TRACCAR_DEVICE_ID);
    stats.traccar = Boolean(env.TRACCAR_URL && env.TRACCAR_TOKEN && Number.isInteger(deviceId) && deviceId > 0);
    const row = {
      id: 1,
      ...(stats.traccar ? { traccarUrl: env.TRACCAR_URL!.replace(/\/$/, ""), traccarToken: env.TRACCAR_TOKEN!, traccarDeviceId: deviceId } : {}),
      ...(tunables
        ? {
            unknownClusterRadiusMeters: Number(tunables.unknown_cluster_radius_meters),
            minDwellMs: Number(tunables.min_dwell_ms),
            stoppedSpeedKmh: Number(tunables.stopped_speed_kmh),
            pollIntervalMs: Number(tunables.poll_interval_ms),
            staleThresholdMs: Number(tunables.stale_threshold_ms),
            lastProcessedAt: tunables.last_processed_at ? new Date(tunables.last_processed_at) : null,
            lastPollSucceededAt: tunables.last_poll_succeeded_at ? new Date(tunables.last_poll_succeeded_at) : null,
          }
        : {}),
    };
    tx.insert(settings).values(row).onConflictDoUpdate({ target: settings.id, set: row }).run();
  });

  // 4. Congress's DB: links to old place ids and the Chamber's exhibit cache.
  db.transaction((tx) => {
    tx.delete(exhibitRefs).where(eq(exhibitRefs.sourceChamber, CHAMBER)).run();
    for (const r of tx.select().from(exhibitRefs).where(like(exhibitRefs.targetId, "place-%")).all()) {
      const id = idFor.get(Number(r.targetId.slice("place-".length)));
      if (!id) continue;
      tx.update(exhibitRefs).set({ targetId: id }).where(eq(exhibitRefs.id, r.id)).run();
      stats.exhibitRefsRewritten++;
    }
    tx.delete(exhibitCache).where(eq(exhibitCache.chamber, CHAMBER)).run();
  });

  forgetChamber(CHAMBER);
  for (const id of idFor.values()) syncRecordExhibit(placeType, id);
  exhibitsDb.insert(imports).values({ key: KEY, ranAt: new Date(), statsJson: JSON.stringify(stats) }).onConflictDoNothing().run();
  return stats;
}
