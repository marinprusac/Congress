import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clampToNow, nextStalenessTransition } from "./poller.js";
import { db, runMigrations } from "./db/client.js";
import { existingPositionIds, recordPosition } from "./positions.js";
import type { TraccarPosition } from "./traccar/client.js";

const HOUR_MS = 60 * 60 * 1000;

// map.traccar_poll_failing only fires on actual HTTP failures - this covers
// the other failure mode, where every poll keeps succeeding (200 OK) while
// the device itself has simply stopped sending real fixes.
describe("nextStalenessTransition", () => {
  it("stays quiet while the gap is under the threshold", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, false)).toBeNull();
  });

  it("fires became_stale the first tick the gap reaches the threshold", () => {
    expect(nextStalenessTransition(12 * HOUR_MS, 12 * HOUR_MS, false)).toBe("became_stale");
    expect(nextStalenessTransition(13 * HOUR_MS, 12 * HOUR_MS, false)).toBe("became_stale");
  });

  it("does not re-fire on every subsequent still-stale tick", () => {
    expect(nextStalenessTransition(20 * HOUR_MS, 12 * HOUR_MS, true)).toBeNull();
  });

  it("fires became_fresh once the gap drops back under the threshold", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, true)).toBe("became_fresh");
  });

  it("does not re-fire became_fresh once already cleared", () => {
    expect(nextStalenessTransition(HOUR_MS, 12 * HOUR_MS, false)).toBeNull();
  });
});

// The poll cursor is the newest fixTime seen, and the next query window runs
// from there to wall-clock now. A fix stamped in the future would leave the
// cursor permanently ahead of every window's end - an inverted range that
// returns nothing forever, with the staleness check seeing a negative gap and
// staying quiet about it. Persisted, so a restart doesn't clear it either.
describe("clampToNow", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("leaves a cursor in the past alone", () => {
    const past = new Date("2026-09-08T11:59:00Z");
    expect(clampToNow(past, now).toISOString()).toBe(past.toISOString());
  });

  it("leaves a cursor exactly at now alone", () => {
    expect(clampToNow(new Date(now), now).toISOString()).toBe(now.toISOString());
  });

  it("pulls a future-stamped fix back to now so the window can never invert", () => {
    const skewed = new Date("2026-09-09T12:00:00Z");
    expect(clampToNow(skewed, now).toISOString()).toBe(now.toISOString());
  });
});

beforeAll(() => runMigrations(migrationsDir("chamber-map")));
beforeEach(() => {
  db.run(sql`delete from positions`);
});

function fix(id: number, fixTime: string): TraccarPosition {
  return { id, deviceId: 1, latitude: 55.7, longitude: 13.2, speed: 0, fixTime, attributes: {} };
}

// Traccar's `from` is inclusive, so every tick refetches the fix the cursor
// points at. Re-running it through tracking.ts is not idempotent (the trip
// accumulator appends the point again), and while a device is silent that
// repeats once per poll interval for hours.
describe("existingPositionIds", () => {
  it("is empty for an empty batch, without touching the DB", () => {
    expect(existingPositionIds([])).toEqual(new Set());
  });

  it("reports only the ids already stored", () => {
    recordPosition(fix(101, "2026-09-08T08:30:06.000Z"));
    recordPosition(fix(102, "2026-09-08T08:30:40.000Z"));
    expect(existingPositionIds([101, 102, 103])).toEqual(new Set([101, 102]));
  });

  it("lets the poller filter a refetched boundary fix out of a mixed batch", () => {
    recordPosition(fix(101, "2026-09-08T08:30:06.000Z"));
    const fetched = [fix(101, "2026-09-08T08:30:06.000Z"), fix(102, "2026-09-08T08:32:00.000Z")];
    const seen = existingPositionIds(fetched.map((p) => p.id));
    expect(fetched.filter((p) => !seen.has(p.id)).map((p) => p.id)).toEqual([102]);
  });

  it("filters the whole batch away when a silent device yields only known fixes", () => {
    recordPosition(fix(101, "2026-09-08T08:30:06.000Z"));
    const fetched = [fix(101, "2026-09-08T08:30:06.000Z")];
    const seen = existingPositionIds(fetched.map((p) => p.id));
    expect(fetched.filter((p) => !seen.has(p.id))).toEqual([]);
  });
});
