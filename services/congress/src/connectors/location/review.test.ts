import { sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { locationDb as db, runLocationMigrations } from "./db/client.js";
import { places, visits } from "./db/schema.js";
import { REVIEW_WINDOW_MS, SETTLE_MS, isReviewed, markReviewed, reviewCandidates, visitContext } from "./review.js";
import { registerLocationTools, thinPath } from "./tools.js";
import { getVisit, listVisits } from "./visits.js";

beforeAll(() => runLocationMigrations());
beforeEach(() => {
  for (const t of ["visit_reviews", "trips", "visits", "places"]) db.run(sql.raw(`delete from ${t}`));
});

const NOW = Date.parse("2026-11-18T12:00:00Z");
const min = (m: number) => new Date(NOW - m * 60_000);

function pending(arrivedMinAgo: number, opts: { departedMinAgo?: number; lat?: number; lon?: number; notified?: boolean; status?: "pending" | "adhoc"; label?: string } = {}) {
  return db
    .insert(visits)
    .values({
      status: opts.status ?? "pending",
      adhocLabel: opts.label ?? null,
      clusterLatitude: opts.lat ?? 45.8,
      clusterLongitude: opts.lon ?? 15.97,
      arrivedAt: min(arrivedMinAgo),
      departedAt: opts.departedMinAgo === undefined ? null : min(opts.departedMinAgo),
      pendingNotifiedAt: opts.notified === false ? null : min(arrivedMinAgo),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .get();
}

describe("which stops are ready for the AI", () => {
  it("takes unreviewed pending stops that ended or have lasted a while, oldest first", async () => {
    const old = pending(300, { departedMinAgo: 200 });
    const longOpen = pending(SETTLE_MS / 60_000 + 5);
    pending(10); // just arrived, still there
    pending(500, { departedMinAgo: 400, notified: false }); // never dwelled long enough
    pending(60, { departedMinAgo: 30, status: "adhoc", label: "Done" }); // already sorted out
    expect((await reviewCandidates(NOW)).map((v) => v.id)).toEqual([old.id, longOpen.id]);
    expect((await reviewCandidates(NOW, 1)).map((v) => v.id)).toEqual([old.id]);
  });

  it("skips stops older than the window and ones already reviewed, even after a rebuild gives them new ids", async () => {
    pending(REVIEW_WINDOW_MS / 60_000 + 60, { departedMinAgo: REVIEW_WINDOW_MS / 60_000 + 30 });
    const a = pending(300, { departedMinAgo: 200 });
    const [v] = await reviewCandidates(NOW);
    expect(v!.id).toBe(a.id);
    markReviewed([v!]);
    expect(isReviewed(v!)).toBe(true);
    expect(await reviewCandidates(NOW)).toEqual([]);

    // History is rebuilt: same stop, new row.
    db.run(sql`delete from visits`);
    pending(300, { departedMinAgo: 200 });
    expect(await reviewCandidates(NOW)).toEqual([]);
  });
});

describe("the evidence around a stop", () => {
  it("lists the nearest Places and the labels given to stops at the same spot", async () => {
    const mk = (id: string, name: string, lat: number, lon: number) => db.insert(places).values({ id, name, latitude: lat, longitude: lon, radiusMeters: 100, updatedAt: new Date() }).run();
    mk("p-near", "Cafe", 45.8005, 15.97); // ~55 m
    mk("p-mid", "Gym", 45.81, 15.97); // ~1.1 km
    mk("p-far", "Cabin", 46.5, 15.97); // far
    pending(900, { departedMinAgo: 800, status: "adhoc", label: "Dentist" });
    pending(700, { departedMinAgo: 600, status: "adhoc", label: "Dentist" });
    pending(500, { departedMinAgo: 400, status: "adhoc", label: "Elsewhere", lat: 46.0 });
    const stop = pending(300, { departedMinAgo: 200 });
    const ctx = await visitContext((await getVisit(stop.id))!);
    expect(ctx.nearbyPlaces.map((p) => [p.id, p.name])).toEqual([["p-near", "Cafe"], ["p-mid", "Gym"]]);
    expect(ctx.nearbyPlaces[0]!.distanceMeters).toBeLessThan(100);
    expect(ctx.pastLabels).toEqual([{ label: "Dentist", times: 2 }]);
  });
});

describe("the AI's place tools", () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
  beforeAll(() => registerLocationTools({ registerTool: (name: string, _c: unknown, handler: never) => tools.set(name, handler) } as unknown as McpServer));
  const call = async (name: string, input: Record<string, unknown>) => JSON.parse((await tools.get(name)!(input)).content[0]!.text);

  it("classifies a pending stop as a label or ignored, and refuses what it can't do", async () => {
    const a = pending(300, { departedMinAgo: 200 });
    const b = pending(150, { departedMinAgo: 100 });
    expect(await call("location_classify_visit", { visitId: a.id, action: "label", label: "Dentist" })).toMatchObject({ status: "adhoc", adhocLabel: "Dentist" });
    expect(await call("location_classify_visit", { visitId: a.id, action: "ignore" })).toMatchObject({ error: "not_pending" });
    expect(await call("location_classify_visit", { visitId: b.id, action: "place", placeId: "nope" })).toMatchObject({ error: "invalid" });
    expect(await call("location_classify_visit", { visitId: b.id, action: "label" })).toMatchObject({ error: "invalid" });
    expect(await call("location_classify_visit", { visitId: 9999, action: "ignore" })).toMatchObject({ error: "not_found" });
    expect(await call("location_classify_visit", { visitId: b.id, action: "ignore" })).toMatchObject({ status: "ignored" });
  });

  it("assigns an existing Place", async () => {
    db.insert(places).values({ id: "p1", name: "Cafe", latitude: 45.8, longitude: 15.97, radiusMeters: 100, updatedAt: new Date() }).run();
    const a = pending(300, { departedMinAgo: 200 });
    expect(await call("location_classify_visit", { visitId: a.id, action: "place", placeId: "p1" })).toMatchObject({ status: "confirmed", placeId: "p1" });
    expect((await listVisits({ status: "confirmed" })).length).toBe(1);
  });

  it("lists pending stops with their evidence and whether they were reviewed", async () => {
    const a = pending(300, { departedMinAgo: 200 });
    markReviewed([(await getVisit(a.id))!]);
    pending(150, { departedMinAgo: 100 });
    const list = await call("location_pending_visits", { limit: 10 });
    expect(list.map((x: { reviewed: boolean }) => x.reviewed)).toEqual([false, true]);
    expect(list[0].visit).toHaveProperty("latitude");
  });
});

describe("thinPath", () => {
  it("keeps the ends and caps the points", () => {
    const path = Array.from({ length: 500 }, (_, i) => ({ latitude: 45 + i / 1000, longitude: 15 }));
    const thin = thinPath(path)!;
    expect(thin.length).toBeLessThanOrEqual(62);
    expect(thin[0]).toEqual([45, 15]);
    expect(thin.at(-1)).toEqual([45.499, 15]);
    expect(thinPath(null)).toBeNull();
    expect(thinPath([])).toBeNull();
  });
});
