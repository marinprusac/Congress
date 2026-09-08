import { and, desc, eq, gte } from "drizzle-orm";
import type { HealthMetric, HealthMetricType, HealthLatest } from "./types.js";
import { db } from "./db/client.js";
import { healthMetrics } from "./db/schema.js";

export function toHealthMetric(row: typeof healthMetrics.$inferSelect): HealthMetric {
  return {
    id: row.id,
    metricType: row.metricType as HealthMetricType,
    value: row.value,
    unit: row.unit,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    sourceName: row.sourceName,
  };
}

export async function listHealthMetrics(opts: {
  metricType?: HealthMetricType;
  since?: Date;
  limit?: number;
}): Promise<HealthMetric[]> {
  const conditions = [
    opts.metricType ? eq(healthMetrics.metricType, opts.metricType) : undefined,
    opts.since ? gte(healthMetrics.startDate, opts.since) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = db
    .select()
    .from(healthMetrics)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(healthMetrics.startDate))
    .limit(opts.limit ?? 100)
    .all();
  return rows.map(toHealthMetric);
}

const ALL_METRIC_TYPES: HealthMetricType[] = ["weight", "vo2Max", "activeEnergy", "restingEnergy", "sleepAsleep"];

// "Night" here means the 24h window ending at the latest sleepAsleep row's
// own endDate - not a fixed local-midnight boundary, since we don't know the
// owner's timezone server-side and a Shortcut-driven "past 2 days" query can
// straddle midnight either way. Summing every row whose interval falls in
// that trailing 24h window is a reasonable proxy for "last night's sleep"
// without needing per-request timezone plumbing.
async function getLatestSleepAsleep(): Promise<HealthMetric | undefined> {
  const rows = db
    .select()
    .from(healthMetrics)
    .where(eq(healthMetrics.metricType, "sleepAsleep"))
    .orderBy(desc(healthMetrics.endDate))
    .limit(50)
    .all();
  const latest = rows[0];
  if (!latest) return undefined;

  const windowStart = new Date(latest.endDate.getTime() - 24 * 60 * 60 * 1000);
  const sameNight = rows.filter((row) => row.endDate >= windowStart);
  const totalSeconds = sameNight.reduce(
    (sum, row) => sum + (row.endDate.getTime() - row.startDate.getTime()) / 1000,
    0
  );

  return {
    id: latest.id,
    metricType: "sleepAsleep",
    value: totalSeconds,
    unit: "s",
    startDate: sameNight[sameNight.length - 1]!.startDate.toISOString(),
    endDate: latest.endDate.toISOString(),
    sourceName: latest.sourceName,
  };
}

// Latest known value per tracked metric type. sleepAsleep is special-cased
// to sum same-night rows (see getLatestSleepAsleep) since ingestion stores
// one row per raw Apple "Asleep"-stage sample rather than a pre-summed
// nightly total - every other type is a plain "most recent row" lookup.
export async function getLatestHealthMetrics(): Promise<HealthLatest> {
  const result: HealthLatest = {};
  for (const type of ALL_METRIC_TYPES) {
    if (type === "sleepAsleep") {
      const sleep = await getLatestSleepAsleep();
      if (sleep) result.sleepAsleep = sleep;
      continue;
    }
    const [row] = await listHealthMetrics({ metricType: type, limit: 1 });
    if (row) result[type] = row;
  }
  return result;
}

// Only used by the unique-index upsert lookup in health/ingest.ts, kept
// here so both read and write paths share one row->DTO mapping helper.
export function findExistingMetric(
  metricType: HealthMetricType,
  startDate: Date,
  endDate: Date
): typeof healthMetrics.$inferSelect | undefined {
  return db
    .select()
    .from(healthMetrics)
    .where(
      and(eq(healthMetrics.metricType, metricType), eq(healthMetrics.startDate, startDate), eq(healthMetrics.endDate, endDate))
    )
    .get();
}
