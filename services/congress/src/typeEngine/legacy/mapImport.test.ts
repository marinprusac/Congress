import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { makeManifest, migrationsDir } from "@congress/test-support";
import { getChamber, registerChamber } from "../../registry.js";
import { db, runMigrations } from "../../db/client.js";
import { exhibitCache, exhibitRefs } from "../../db/schema.js";
import { startTypeEngine } from "../index.js";
import { getRecord, manualRefs } from "../records.js";
import { resolveLegacyAlias } from "../aliases.js";
import { getTypeBySlug } from "../store.js";
import { runLocationMigrations } from "../../connectors/location/db/client.js";
import { listTrips, listVisits } from "../../connectors/location/visits.js";
import { traccarConfig, getSettings } from "../../connectors/location/settings.js";
import { importLegacyMap } from "./mapImport.js";

let from = "";
const T = Date.parse("2026-09-20T08:00:00Z");

beforeAll(() => {
  runMigrations(migrationsDir("congress"));
  runLocationMigrations();
  startTypeEngine();

  from = join(mkdtempSync(join(tmpdir(), "map-import-")), "map.sqlite3");
  const map = new Database(from);
  map.exec(`
    CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT, body TEXT, latitude REAL, longitude REAL, radius_meters INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE place_refs (id INTEGER PRIMARY KEY, place_id INTEGER, target_exhibit_id TEXT, created_at INTEGER);
    CREATE TABLE positions (id INTEGER PRIMARY KEY, traccar_position_id INTEGER, latitude REAL, longitude REAL, speed_knots REAL, fix_time INTEGER, created_at INTEGER);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, place_id INTEGER, status TEXT, adhoc_label TEXT, cluster_latitude REAL, cluster_longitude REAL, arrived_at INTEGER, departed_at INTEGER, pending_notified_at INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE trips (id INTEGER PRIMARY KEY, from_visit_id INTEGER, to_visit_id INTEGER, departed_at INTEGER, arrived_at INTEGER, distance_km REAL, mode TEXT, path TEXT, created_at INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, unknown_cluster_radius_meters INTEGER, min_dwell_ms INTEGER, stopped_speed_kmh REAL, poll_interval_ms INTEGER, stale_threshold_ms INTEGER, last_processed_at INTEGER, last_poll_succeeded_at INTEGER, last_poll_error TEXT);
  `);
  map.prepare("INSERT INTO places VALUES (3, 'Home', 'My [[exhibit:e:x|flat]]', 45.1, 14.2, 80, ?, ?)").run(T, T);
  map.prepare("INSERT INTO place_refs (place_id, target_exhibit_id, created_at) VALUES (3, 'note-9', 0)").run();
  map.prepare("INSERT INTO positions VALUES (1, 501, 45.1, 14.2, 0, ?, ?)").run(T, T);
  map.prepare("INSERT INTO visits VALUES (10, 3, 'confirmed', NULL, NULL, NULL, ?, ?, NULL, ?, ?)").run(T, T + 3_600_000, T, T);
  map.prepare("INSERT INTO visits VALUES (11, NULL, 'adhoc', 'Errand', 45.2, 14.3, ?, NULL, ?, ?, ?)").run(T + 4_000_000, T + 4_000_000, T, T);
  map.prepare("INSERT INTO trips VALUES (20, 10, 11, ?, ?, 2.5, 'walk', '[[45.1,14.2],[45.2,14.3]]', ?)").run(T + 3_600_000, T + 4_000_000, T);
  map.prepare("INSERT INTO settings VALUES (1, 150, 900000, 3, 120000, 43200000, ?, ?, NULL)").run(T + 4_000_000, T + 4_000_000);
  map.close();

  registerChamber(makeManifest("map"));
  db.insert(exhibitRefs).values({ sourceId: "note-1", sourceChamber: "notes", targetId: "place-3" }).run();
  db.insert(exhibitCache).values({ id: "place-3", chamber: "map", type: "place", name: "Home", url: "/p/3", updatedAt: new Date() }).run();
});

describe("the Map cutover", () => {
  it("makes places records, and moves the GPS log, visits, trips and Traccar into the connector", async () => {
    const stats = importLegacyMap({ from, env: { TRACCAR_URL: "https://traccar.example/", TRACCAR_TOKEN: "tok", TRACCAR_DEVICE_ID: "4" } });
    expect(stats).toEqual({ places: 1, refs: 1, refsMissing: 0, exhibitRefsRewritten: 1, positions: 1, visits: 2, visitsUnplaced: 0, trips: 1, traccar: true });

    const home = resolveLegacyAlias("map", "place-3")!;
    expect(getRecord(home)?.values).toMatchObject({ name: "Home", notes: "My [[exhibit:e:x|flat]]", latitude: 45.1, longitude: 14.2, radius: 80 });
    expect(manualRefs(home)).toEqual(["note-9"]);
    expect(db.select().from(exhibitRefs).where(eq(exhibitRefs.sourceId, "note-1")).get()?.targetId).toBe(home);
    expect(db.select().from(exhibitCache).where(eq(exhibitCache.chamber, "map")).all()).toEqual([]);

    const visits = await listVisits();
    expect(visits.map((v) => [v.id, v.placeId, v.placeName, v.status, v.adhocLabel])).toEqual([
      [11, null, null, "adhoc", "Errand"],
      [10, home, "Home", "confirmed", null],
    ]);
    expect((await listTrips())[0]).toMatchObject({ id: 20, fromLabel: "Home", toLabel: "Errand", mode: "walk" });
    expect(traccarConfig()).toEqual({ url: "https://traccar.example", token: "tok", deviceId: 4 });
    expect(await getSettings()).toMatchObject({ minDwellMs: 900000, pollIntervalMs: 120000 });
    expect(getChamber("map")).toBeNull();
    expect(getTypeBySlug("place")!.definition.hidden).toBe(false);
  });

  it("runs once", () => {
    expect(importLegacyMap({ from }).skipped).toBe("already_ran");
  });
});
