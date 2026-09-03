import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { places, visits } from "./db/schema.js";
import {
  accumulateTripFix,
  closeVisit,
  createTrip,
  createTripFixAccumulator,
  getOpenVisit,
  getVisitActiveAt,
  guessTripMode,
  listTrips,
  listVisits,
  openConfirmedVisit,
  openPendingVisit,
  type TripFixAccumulator,
} from "./visits.js";

beforeAll(() => runMigrations(migrationsDir("chamber-map")));

beforeEach(() => {
  db.run(sql`delete from trips`);
  db.run(sql`delete from visits`);
  db.run(sql`delete from places`);
});

const KNOTS_PER_KMH = 1 / 1.852;

// Builds an accumulator from a list of fixes laid out as a straight line
// north from the equator (~111.1949 km per degree of latitude), each `km`
// further along than the one before. The first entry is the starting point,
// so it contributes no distance - same as a real trip's first fix.
function accWith(fixes: { km: number; kmh: number }[]): TripFixAccumulator {
  const acc = createTripFixAccumulator();
  let lat = 0;
  for (const fix of fixes) {
    lat += fix.km / 111.1949;
    accumulateTripFix(acc, { latitude: lat, longitude: 0, speedKnots: fix.kmh * KNOTS_PER_KMH });
  }
  return acc;
}

function makePlace(name: string, latitude: number, longitude: number, radiusMeters = 100) {
  return db
    .insert(places)
    .values({ name, latitude, longitude, radiusMeters, createdAt: new Date(), updatedAt: new Date() })
    .returning()
    .get();
}

describe("guessTripMode", () => {
  // Three tuned constants decide what the owner sees as the mode of every
  // trip: WALK_MAX_KMH 7, BIKE_MAX_KMH 25, UNTRACKED_TRANSIT_KM 2.
  it("calls a trip with no fixes at all unknown", () => {
    expect(guessTripMode(createTripFixAccumulator(), 0)).toBe("unknown");
  });

  it("calls a slow tracked trip a walk", () => {
    expect(guessTripMode(accWith([{ km: 0, kmh: 5 }, { km: 0.5, kmh: 5 }]), 0.5)).toBe("walk");
  });

  it("calls a trip between walking and cycling pace a bike ride", () => {
    expect(guessTripMode(accWith([{ km: 0, kmh: 18 }, { km: 3, kmh: 18 }]), 3)).toBe("bike");
  });

  it("treats exactly the walking ceiling as a bike ride, since the walk test is strict", () => {
    expect(guessTripMode(accWith([{ km: 0, kmh: 7 }, { km: 1, kmh: 7 }]), 1)).toBe("bike");
  });

  it("calls anything at or above cycling pace transit", () => {
    expect(guessTripMode(accWith([{ km: 0, kmh: 25 }, { km: 10, kmh: 25 }]), 10)).toBe("transit");
    expect(guessTripMode(accWith([{ km: 0, kmh: 90 }, { km: 40, kmh: 90 }]), 40)).toBe("transit");
  });

  it("calls a long untracked hop transit even with no fast fix recorded", () => {
    // A flight: a couple of slow fixes at each end, hundreds of kilometres
    // of silence between them. Judged on untracked distance, not fix count,
    // so a handful of fixes at one end cannot make it read as a walk.
    expect(guessTripMode(accWith([{ km: 0, kmh: 4 }, { km: 0.2, kmh: 4 }]), 800)).toBe("transit");
  });

  it("forgives a short untracked gap, so a tunnel does not turn a walk into transit", () => {
    // 1.5 km unaccounted for is under UNTRACKED_TRANSIT_KM.
    expect(guessTripMode(accWith([{ km: 0, kmh: 5 }, { km: 1, kmh: 5 }]), 2.5)).toBe("walk");
  });

  it("never treats a negative untracked distance as a signal", () => {
    // Tracked distance can exceed the straight line whenever the route bends.
    expect(guessTripMode(accWith([{ km: 0, kmh: 5 }, { km: 5, kmh: 5 }]), 1)).toBe("walk");
  });
});

describe("accumulateTripFix", () => {
  it("sums distance between consecutive fixes and keeps every point", () => {
    const acc = accWith([
      { km: 1, kmh: 5 },
      { km: 1, kmh: 5 },
    ]);
    expect(acc.count).toBe(2);
    expect(acc.points).toHaveLength(2);
    expect(acc.distanceKm).toBeCloseTo(1, 2);
  });

  it("does not count distance for the first fix, which has nothing to measure from", () => {
    const acc = accWith([{ km: 5, kmh: 5 }]);
    expect(acc.distanceKm).toBe(0);
  });

  it("keeps the maximum speed seen, not the last", () => {
    const acc = accWith([
      { km: 1, kmh: 40 },
      { km: 1, kmh: 3 },
    ]);
    expect(acc.maxSpeedKnots).toBeCloseTo(40 * KNOTS_PER_KMH, 4);
  });
});

describe("createTrip", () => {
  async function tripBetween(acc: TripFixAccumulator, from: { latitude: number; longitude: number } | null, to: typeof from) {
    const a = makePlace("A", 45, 9);
    const b = makePlace("B", 45.1, 9);
    const v1 = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v1.id, new Date("2026-01-01T08:30:00Z"));
    const v2 = openConfirmedVisit(b.id, new Date("2026-01-01T09:00:00Z"));
    return createTrip(v1.id, v2.id, new Date("2026-01-01T08:30:00Z"), new Date("2026-01-01T09:00:00Z"), acc, from, to);
  }

  it("reports the straight-line endpoint distance when it exceeds what was actually tracked", () => {
    // A flight's tracked distance undercounts badly; the endpoints do not.
    return tripBetween(accWith([{ km: 0.5, kmh: 4 }]), { latitude: 45, longitude: 9 }, { latitude: 46, longitude: 9 }).then(
      (trip) => {
        expect(trip.distanceKm).toBeCloseTo(111.19, 0);
      }
    );
  });

  it("reports the tracked distance when the route was longer than the straight line", async () => {
    const trip = await tripBetween(
      accWith([
        { km: 5, kmh: 20 },
        { km: 5, kmh: 20 },
      ]),
      { latitude: 45, longitude: 9 },
      { latitude: 45.001, longitude: 9 }
    );
    expect(trip.distanceKm).toBeCloseTo(5, 1);
  });

  it("anchors the drawn path with both endpoints, so a silent trip still renders", async () => {
    const trip = await tripBetween(createTripFixAccumulator(), { latitude: 45, longitude: 9 }, { latitude: 46, longitude: 9 });
    expect(trip.path).toEqual([
      { latitude: 45, longitude: 9 },
      { latitude: 46, longitude: 9 },
    ]);
  });

  it("leaves the path null only when there is nothing at all to draw", async () => {
    const trip = await tripBetween(createTripFixAccumulator(), null, null);
    expect(trip.path).toBeNull();
  });

  it("computes duration in whole minutes from the two timestamps", async () => {
    const trip = await tripBetween(accWith([{ km: 1, kmh: 5 }]), null, null);
    expect(trip.durationMinutes).toBe(30);
  });
});

describe("needsLabel", () => {
  async function roundTrip(samePlace: boolean, label: string | null = null) {
    const a = makePlace("Home", 45, 9);
    const b = samePlace ? a : makePlace("Work", 45.1, 9);
    const v1 = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v1.id, new Date("2026-01-01T08:30:00Z"));
    const v2 = openConfirmedVisit(b.id, new Date("2026-01-01T09:00:00Z"));
    return createTrip(
      v1.id,
      v2.id,
      new Date("2026-01-01T08:30:00Z"),
      new Date("2026-01-01T09:00:00Z"),
      createTripFixAccumulator(),
      null,
      null,
      label
    );
  }

  it("asks about an unlabelled round trip to the same place, which explains nothing on its own", async () => {
    expect((await roundTrip(true)).needsLabel).toBe(true);
  });

  it("does not ask about a trip between two different places", async () => {
    expect((await roundTrip(false)).needsLabel).toBe(false);
  });

  it("stops asking once a label is given", async () => {
    const trip = await roundTrip(true, "school run");
    expect(trip.label).toBe("school run");
    expect(trip.needsLabel).toBe(false);
  });

  it("does not ask about a trip between two unclassified dwells, which have no place to be the same", async () => {
    const v1 = openPendingVisit(45, 9, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v1.id, new Date("2026-01-01T08:30:00Z"));
    const v2 = openPendingVisit(45.1, 9, new Date("2026-01-01T09:00:00Z"));
    const trip = await createTrip(
      v1.id,
      v2.id,
      new Date("2026-01-01T08:30:00Z"),
      new Date("2026-01-01T09:00:00Z"),
      createTripFixAccumulator(),
      null,
      null
    );
    expect(trip.needsLabel).toBe(false);
  });
});

describe("getVisitActiveAt", () => {
  // The day view's own window only returns visits that *arrived* inside it,
  // which says nothing about a day spent entirely at a stay that began
  // earlier. This is what bookends such a day with a location.
  it("returns the most recent visit that had already started, even though it began days earlier", async () => {
    const a = makePlace("Cabin", 45, 9);
    const v = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v.id, new Date("2026-01-05T08:00:00Z"));

    const active = await getVisitActiveAt(new Date("2026-01-03T12:00:00Z"));
    expect(active?.id).toBe(v.id);
    expect(active?.placeName).toBe("Cabin");
  });

  it("returns a still-open visit", async () => {
    const a = makePlace("Home", 45, 9);
    openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    await expect(getVisitActiveAt(new Date("2026-01-02T00:00:00Z"))).resolves.toMatchObject({ placeName: "Home" });
  });

  it("returns null before any visit exists", async () => {
    const a = makePlace("Home", 45, 9);
    openConfirmedVisit(a.id, new Date("2026-01-02T08:00:00Z"));
    await expect(getVisitActiveAt(new Date("2026-01-01T00:00:00Z"))).resolves.toBeNull();
  });

  it("picks the later of two visits that both started before the instant", async () => {
    const a = makePlace("A", 45, 9);
    const b = makePlace("B", 46, 9);
    const first = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(first.id, new Date("2026-01-01T09:00:00Z"));
    const second = openConfirmedVisit(b.id, new Date("2026-01-01T10:00:00Z"));

    await expect(getVisitActiveAt(new Date("2026-01-01T11:00:00Z"))).resolves.toMatchObject({ id: second.id });
  });
});

describe("listVisits", () => {
  it("hides a pending dwell that never crossed the dwell threshold", async () => {
    // Only a dwell that reached minDwellMs gets pendingNotifiedAt set, and
    // only those are worth asking the owner about - every fleeting unmatched
    // fix along a drive opens and closes a pending row in seconds.
    const notified = openPendingVisit(45, 9, new Date("2026-01-01T08:00:00Z"));
    db.update(visits).set({ pendingNotifiedAt: new Date() }).where(sql`id = ${notified.id}`).run();
    openPendingVisit(46, 9, new Date("2026-01-01T09:00:00Z"));

    const pending = await listVisits({ status: "pending" });
    expect(pending.map((v) => v.id)).toEqual([notified.id]);
  });

  it("computes duration only for a departed visit", async () => {
    const a = makePlace("Home", 45, 9);
    const closed = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(closed.id, new Date("2026-01-01T09:30:00Z"));

    const [visit] = await listVisits({});
    expect(visit?.durationMinutes).toBe(90);

    db.run(sql`delete from visits`);
    openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    expect((await listVisits({}))[0]?.durationMinutes).toBeNull();
  });

  it("falls back to the cluster coordinates when a visit has no place", async () => {
    openPendingVisit(45.5, 9.5, new Date("2026-01-01T08:00:00Z"));
    const [visit] = await listVisits({});
    expect(visit).toMatchObject({ latitude: 45.5, longitude: 9.5, placeName: null });
  });
});

describe("getOpenVisit", () => {
  it("finds the one visit with no departure recorded", () => {
    const a = makePlace("Home", 45, 9);
    const closed = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(closed.id, new Date("2026-01-01T09:00:00Z"));
    const open = openConfirmedVisit(a.id, new Date("2026-01-01T10:00:00Z"));

    expect(getOpenVisit()?.id).toBe(open.id);
  });

  it("returns null when every visit has departed", () => {
    const a = makePlace("Home", 45, 9);
    const v = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v.id, new Date("2026-01-01T09:00:00Z"));
    expect(getOpenVisit()).toBeNull();
  });
});

describe("listTrips", () => {
  it("labels each end by place name, falling back for an unclassified dwell", async () => {
    const a = makePlace("Home", 45, 9);
    const v1 = openConfirmedVisit(a.id, new Date("2026-01-01T08:00:00Z"));
    closeVisit(v1.id, new Date("2026-01-01T08:30:00Z"));
    const v2 = openPendingVisit(46, 9, new Date("2026-01-01T09:00:00Z"));
    await createTrip(
      v1.id,
      v2.id,
      new Date("2026-01-01T08:30:00Z"),
      new Date("2026-01-01T09:00:00Z"),
      createTripFixAccumulator(),
      null,
      null
    );

    const [trip] = await listTrips({});
    expect(trip).toMatchObject({ fromLabel: "Home", toLabel: "Unknown location" });
  });
});
