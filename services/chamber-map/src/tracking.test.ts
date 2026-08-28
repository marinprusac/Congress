import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { places, positions } from "./db/schema.js";
import { processPositions, resetTrackingState } from "./tracking.js";
import { listTrips, listVisits } from "./visits.js";
import type { TraccarPosition } from "./traccar/client.js";

// End-to-end classifier tests: a synthetic GPS trace goes in, visits and
// trips come out. This is the part of the system a change can corrupt
// permanently - visits/trips are the durable personal record the Chamber
// exists to produce, and unlike event_history they have no retention sweep
// to age a bad run out.
//
// Events are suppressed (the flag already exists for historical replays), so
// nothing here depends on Congress being reachable.

beforeAll(() => runMigrations(migrationsDir("chamber-map")));

beforeEach(() => {
  db.run(sql`delete from trips`);
  db.run(sql`delete from visits`);
  db.run(sql`delete from places`);
  db.run(sql`delete from positions`);
  resetTrackingState();
  nextFixId = 1;
});

// Default settings, restated because every trace below is designed around
// them: unknownClusterRadiusMeters 150, minDwellMs 15min, stoppedSpeedKmh 3.
const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const HOME_LAT = 45.0;
const WORK_LAT = 45.05; // ~5.6 km north of home
const LON = 9.0;

let nextFixId = 1;

// At this latitude 0.001 degrees is ~111 m, so a fix 0.01 north of another
// one minute later reads as ~67 km/h - comfortably "moving".
function fix(latitude: number, minuteOffset: number, reportedKnots = 0): TraccarPosition {
  return {
    id: nextFixId++,
    deviceId: 1,
    latitude,
    longitude: LON,
    speed: reportedKnots,
    fixTime: new Date(T0 + minuteOffset * 60_000).toISOString(),
    attributes: {},
  };
}

function place(name: string, latitude: number, radiusMeters = 100) {
  return db
    .insert(places)
    .values({ name, latitude, longitude: LON, radiusMeters, createdAt: new Date(), updatedAt: new Date() })
    .returning()
    .get();
}

function run(fixes: TraccarPosition[]) {
  return processPositions(fixes, { publishEvents: false });
}

describe("a drive between two known places", () => {
  beforeEach(() => {
    place("Home", HOME_LAT);
    place("Work", WORK_LAT);
  });

  it("produces one visit at each end and a single trip between them", async () => {
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.02, 2),
      fix(45.03, 3),
      fix(45.04, 4),
      fix(WORK_LAT, 5),
    ]);

    const visits = await listVisits({});
    expect(visits.map((v) => v.placeName)).toEqual(["Work", "Home"]); // newest first
    expect(visits.every((v) => v.status === "confirmed")).toBe(true);
    expect(await listTrips({})).toHaveLength(1);
  });

  it("leaves no unclassified dots along the route", async () => {
    await run([fix(HOME_LAT, 0), fix(45.01, 1), fix(45.02, 2), fix(45.03, 3), fix(45.04, 4), fix(WORK_LAT, 5)]);
    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(0);
  });

  it("records the departure at the first fix outside the place, not at the arrival at the far end", async () => {
    // Otherwise a departed_place event's reported dwell is inflated by
    // however long the following trip took.
    await run([fix(HOME_LAT, 0), fix(45.01, 1), fix(45.02, 2), fix(WORK_LAT, 30)]);
    const home = (await listVisits({})).find((v) => v.placeName === "Home");
    expect(home?.departedAt).toBe(new Date(T0 + 60_000).toISOString());
  });

  it("does not open a second visit while fixes keep landing inside the same place", async () => {
    await run([fix(HOME_LAT, 0), fix(HOME_LAT + 0.0005, 1), fix(HOME_LAT, 2), fix(HOME_LAT + 0.0002, 3)]);
    expect(await listVisits({})).toHaveLength(1);
  });

  it("names a commute between two different places automatically", async () => {
    await run([fix(HOME_LAT, 0), fix(45.02, 1), fix(WORK_LAT, 2)]);
    expect((await listTrips({}))[0]?.label).toBe("commute to Work");
  });
});

describe("a brief stop mid-route", () => {
  beforeEach(() => {
    place("Home", HOME_LAT);
    place("Work", WORK_LAT);
  });

  it("folds into the trip rather than leaving a dot, when it never reaches the dwell threshold", async () => {
    // A red light or a drive-thru queue: stationary fixes, but only for a
    // few minutes. "A dot means you stayed somewhere long enough to matter."
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.025, 2),
      fix(45.025, 3), // stopped
      fix(45.025, 5), // still stopped, 2 min in
      fix(45.04, 6), // moving again
      fix(WORK_LAT, 7),
    ]);

    const visits = await listVisits({});
    expect(visits.map((v) => v.placeName)).toEqual(["Work", "Home"]);
    expect(await listTrips({})).toHaveLength(1);
  });
});

describe("an unmatched dwell that lasts", () => {
  beforeEach(() => {
    place("Home", HOME_LAT);
    place("Work", WORK_LAT);
  });

  it("becomes a pending visit once it crosses the dwell threshold", async () => {
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.025, 2),
      fix(45.025, 3), // arrives at the unknown spot
      fix(45.025, 10),
      fix(45.0251, 20), // 17 minutes in - promotes
      fix(WORK_LAT, 30),
    ]);

    const pending = (await listVisits({})).filter((v) => v.status === "pending");
    expect(pending).toHaveLength(1);
    // Arrival is backdated to the first stopped fix, not to the moment the
    // threshold happened to be crossed.
    expect(pending[0]?.arrivedAt).toBe(new Date(T0 + 3 * 60_000).toISOString());
  });

  it("links into trips on both sides", async () => {
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.025, 2),
      fix(45.025, 3),
      fix(45.0251, 20),
      fix(WORK_LAT, 30),
    ]);
    expect(await listTrips({})).toHaveLength(2);
  });

  it("is surfaced for classification, unlike a fleeting one", async () => {
    // listVisits({status:"pending"}) only returns dwells that were actually
    // notified, which is what a promoted dwell gets and a transient one
    // never does.
    await run([fix(HOME_LAT, 0), fix(45.01, 1), fix(45.025, 2), fix(45.025, 3), fix(45.0251, 20), fix(WORK_LAT, 30)]);
    expect(await listVisits({ status: "pending" })).toHaveLength(1);
  });
});

describe("the gap-credit heuristic", () => {
  // The device goes quiet right after a stopped fix and only reappears
  // later. Where it reappears is the only evidence of what the silence was.
  beforeEach(() => {
    place("Home", HOME_LAT);
  });

  it("credits the silence to the stop when the device drifts back into view nearby", async () => {
    place("Work", WORK_LAT);
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.025, 2),
      fix(45.025, 3), // stops; then an hour of indoor GPS silence
      fix(45.027, 60), // ~222 m away: within 3x the cluster radius
      fix(WORK_LAT, 65),
    ]);

    const pending = (await listVisits({})).filter((v) => v.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.arrivedAt).toBe(new Date(T0 + 3 * 60_000).toISOString());
    expect(pending[0]?.departedAt).toBe(new Date(T0 + 60 * 60_000).toISOString());
  });

  it("credits the silence to travel when the device reappears far away", async () => {
    // Otherwise a flight or a train ride invents an hour-long dwell at the
    // departure gate.
    place("Far", 46.0);
    await run([
      fix(HOME_LAT, 0),
      fix(45.01, 1),
      fix(45.025, 2),
      fix(45.025, 3),
      fix(46.0, 60), // ~110 km away
      fix(46.0, 65),
    ]);

    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(0);
    expect((await listVisits({})).map((v) => v.placeName)).toEqual(["Far", "Home"]);
  });
});

describe("speed measurement", () => {
  // Speed is derived from displacement since the previous fix rather than
  // read off the device's own instantaneous field - walking a few steps
  // between shop aisles reports 3-7 km/h and would otherwise look like
  // travel. The device's own figure is used only where there is nothing to
  // measure against.
  it("falls back to the reported speed for the very first fix after a restart", async () => {
    place("Home", HOME_LAT);

    // First batch is a single unmatched fix reporting a standstill: with the
    // fallback, that starts a candidate dwell.
    await run([fix(45.025, 0, 0)]);
    await run([fix(45.025, 20, 0)]);

    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(1);
  });

  it("does not start a dwell from a first fix that reports real movement", async () => {
    place("Home", HOME_LAT);

    await run([fix(45.025, 0, 50)]); // 50 knots ~ 93 km/h
    await run([fix(45.025, 20, 0)]);

    // The 20-minute mark starts the candidate instead, so nothing has
    // dwelled long enough yet.
    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(0);
  });
});

describe("state carried across poll ticks", () => {
  it("promotes a dwell whose fixes arrived in separate batches", async () => {
    // Dwell time is only ever accumulated across poll ticks - each tick
    // carries just the handful of fixes seen since the last one.
    place("Home", HOME_LAT);
    place("Work", WORK_LAT);

    await run([fix(HOME_LAT, 0), fix(45.01, 1), fix(45.025, 2), fix(45.025, 3)]);
    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(0);

    await run([fix(45.025, 10)]);
    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(0);

    await run([fix(45.0251, 20)]);
    expect((await listVisits({})).filter((v) => v.status === "pending")).toHaveLength(1);
  });

  it("re-derives the open visit from the database rather than in-memory state", async () => {
    // A restart must not lose track of where the device currently is.
    place("Home", HOME_LAT);
    place("Work", WORK_LAT);

    await run([fix(HOME_LAT, 0)]);
    resetTrackingState(); // as if the process restarted here
    await run([fix(45.02, 5), fix(WORK_LAT, 6)]);

    const visits = await listVisits({});
    expect(visits.map((v) => v.placeName)).toEqual(["Work", "Home"]);
    expect(visits.find((v) => v.placeName === "Home")?.departedAt).not.toBeNull();
  });
});

describe("the raw position log", () => {
  it("records every fix, regardless of what the classifier decides about it", async () => {
    // positions is the source of truth visits and trips are derived from -
    // a reprocess replays it - so nothing Traccar reports may be dropped by
    // a classification decision.
    place("Home", HOME_LAT);
    await run([fix(HOME_LAT, 0), fix(45.01, 1), fix(45.02, 2)]);
    expect(db.select().from(positions).all()).toHaveLength(3);
  });

  it("does not log the same fix twice when two poll windows overlap", async () => {
    place("Home", HOME_LAT);
    const overlapping = fix(HOME_LAT, 0);
    await run([overlapping]);
    await run([overlapping]);
    expect(db.select().from(positions).all()).toHaveLength(1);
  });
});
