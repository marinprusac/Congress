import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { healthMetrics } from "./db/schema.js";
import { listHealthMetrics, getLatestHealthMetrics } from "./healthMetrics.js";
import type { HealthMetricType } from "./types.js";

beforeAll(() => runMigrations(migrationsDir("chamber-fitness")));

beforeEach(() => db.run(sql`delete from health_metrics`));

function insertMetric(metricType: HealthMetricType, value: number, startDate: Date, endDate = startDate) {
  return db
    .insert(healthMetrics)
    .values({ metricType, value, unit: "kg", startDate, endDate, createdAt: startDate })
    .returning()
    .get();
}

describe("listHealthMetrics", () => {
  it("filters by metricType", async () => {
    insertMetric("weight", 80, new Date("2026-09-01T00:00:00Z"));
    insertMetric("vo2Max", 45, new Date("2026-09-01T00:00:00Z"));

    const results = await listHealthMetrics({ metricType: "weight" });
    expect(results).toHaveLength(1);
    expect(results[0]?.metricType).toBe("weight");
  });

  it("filters by since", async () => {
    insertMetric("weight", 80, new Date("2026-08-01T00:00:00Z"));
    insertMetric("weight", 81, new Date("2026-09-05T00:00:00Z"));

    const results = await listHealthMetrics({ since: new Date("2026-09-01T00:00:00Z") });
    expect(results).toHaveLength(1);
    expect(results[0]?.value).toBe(81);
  });

  it("respects limit and orders newest-first", async () => {
    insertMetric("weight", 80, new Date("2026-09-01T00:00:00Z"));
    insertMetric("weight", 81, new Date("2026-09-03T00:00:00Z"));
    insertMetric("weight", 82, new Date("2026-09-05T00:00:00Z"));

    const results = await listHealthMetrics({ limit: 2 });
    expect(results.map((r) => r.value)).toEqual([82, 81]);
  });
});

describe("getLatestHealthMetrics", () => {
  it("returns only metric types that have at least one row", async () => {
    insertMetric("weight", 80, new Date("2026-09-01T00:00:00Z"));

    const latest = await getLatestHealthMetrics();
    expect(Object.keys(latest)).toEqual(["weight"]);
  });

  it("sums same-night sleepAsleep rows into one value, rather than returning a single arbitrary interval", async () => {
    // Two sleep stages from the same night, 4h apart, each 3h long.
    insertMetric("sleepAsleep", 0, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T03:00:00Z"));
    insertMetric("sleepAsleep", 0, new Date("2026-09-08T04:00:00Z"), new Date("2026-09-08T07:00:00Z"));

    const latest = await getLatestHealthMetrics();
    expect(latest.sleepAsleep?.value).toBe(6 * 3600);
  });

  it("does not fold in a much older, unrelated sleep interval into the latest-night sum", async () => {
    insertMetric("sleepAsleep", 0, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-01T08:00:00Z"));
    insertMetric("sleepAsleep", 0, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T02:00:00Z"));

    const latest = await getLatestHealthMetrics();
    expect(latest.sleepAsleep?.value).toBe(2 * 3600);
  });

  it("picks the most recent startDate per type for non-sleep metrics", async () => {
    insertMetric("weight", 80, new Date("2026-09-01T00:00:00Z"));
    insertMetric("weight", 81, new Date("2026-09-05T00:00:00Z"));

    const latest = await getLatestHealthMetrics();
    expect(latest.weight?.value).toBe(81);
  });
});
