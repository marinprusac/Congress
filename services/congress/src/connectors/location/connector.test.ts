import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrationsDir } from "@congress/test-support";
import { runMigrations } from "../../db/client.js";
import { startTypeEngine } from "../../typeEngine/index.js";
import { createRecord, deleteRecord, updateRecord } from "../../typeEngine/records.js";
import { runningConnector, startConnectors, stopConnectors } from "../registry.js";
import { locationConnector, placeFromRecord } from "./index.js";
import { getPlace, listPlaces } from "./places.js";
import { processPositions, resetTrackingState, withTrackingLock } from "./tracking.js";
import { listVisits } from "./visits.js";
import { writeRow } from "./settings.js";
import type { TraccarPosition } from "./traccar.js";

const T0 = Date.parse("2026-09-01T08:00:00.000Z");
let nextId = 1;
const fix = (latitude: number, minute: number): TraccarPosition => ({
  id: nextId++,
  deviceId: 1,
  latitude,
  longitude: 9,
  speed: 0,
  fixTime: new Date(T0 + minute * 60_000).toISOString(),
  attributes: {},
});

beforeAll(async () => {
  runMigrations(migrationsDir("congress"));
  startTypeEngine();
  await startConnectors([locationConnector]);
});

afterAll(() => stopConnectors());

describe("Place records as the location connector's input", () => {
  it("mirrors places as they're made, moved and removed", async () => {
    const home = createRecord("place", { name: "Home", latitude: 45, longitude: 9, radius: 80 }).id;
    expect(getPlace(home)).toMatchObject({ name: "Home", latitude: 45, radiusMeters: 80 });
    updateRecord(home, { name: "Flat", latitude: 45.001 });
    expect(getPlace(home)).toMatchObject({ name: "Flat", latitude: 45.001 });
    deleteRecord(home);
    expect(getPlace(home)).toBeUndefined();
  });

  it("uses 100 m when a place has no radius, and skips one without a position", () => {
    expect(placeFromRecord("p", { name: "Gym", latitude: 1, longitude: 2, radius: null })).toMatchObject({ radiusMeters: 100 });
    expect(placeFromRecord("p", { name: "Nowhere", latitude: null, longitude: 2 })).toBeNull();
  });

  it("confirms a pending stop there once the place is made, and a stale classify is harmless", async () => {
    resetTrackingState();
    const stay = [0, 5, 10, 15, 20, 25].map((m) => fix(45.2, m));
    await withTrackingLock(() => processPositions([...stay, fix(45.3, 40)], { publishEvents: false }));
    const pending = (await listVisits()).find((v) => v.status === "pending")!;
    expect(pending).toBeDefined();

    const cafe = createRecord("place", { name: "Cafe", latitude: 45.2, longitude: 9, radius: 100 }).id;
    await vi.waitFor(async () => expect((await listVisits()).some((v) => v.placeId === cafe && v.status === "confirmed")).toBe(true));

    const routes = runningConnector("location")!.connector.routes!(runningConnector("location")!.ctx);
    const direct = await routes.request(`/visits/${pending.id}/classify`, { method: "POST", body: JSON.stringify({ action: "assign_place", placeId: cafe }) });
    expect(await direct.json()).toEqual({ gone: true });
  });

  it("offers the feed only once it's tracking", async () => {
    expect(await locationConnector.feed!(new Date())).toEqual([]);
    writeRow({ traccarUrl: "https://traccar.example", traccarToken: "t", traccarDeviceId: 1 });
    const groups = await locationConnector.feed!(new Date());
    expect(groups.map((g) => g.source)).toEqual(["map", "e"]);
    expect(groups[0]!.candidates).toEqual([{ kind: "view", viewId: "today-map", score: 15 }]);
    writeRow({ traccarUrl: null, traccarToken: null, traccarDeviceId: null });
    expect((await listPlaces()).map((p) => p.name)).toEqual(["Cafe"]);
  });
});
