import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { healthDb as db } from "./db/client.js";
import { healthMetrics, settings } from "./db/schema.js";
import { HEALTH_METRIC_TYPES, type HealthLatest, type HealthMetric, type HealthMetricType } from "./types.js";
import type { NormalizedHealthSample } from "./normalize.js";

type Row = typeof healthMetrics.$inferSelect;

const toMetric = (row: Row): HealthMetric => ({
  id: row.id,
  metricType: row.metricType as HealthMetricType,
  value: row.value,
  unit: row.unit,
  startDate: row.startDate.toISOString(),
  endDate: row.endDate.toISOString(),
  sourceName: row.sourceName,
});

// Upserts by (type, start, end): resends update in place. `changed` is true
// when anything is new or its value moved (a byte-identical resend isn't).
export function ingestSamples(samples: NormalizedHealthSample[]): { accepted: number; duplicated: number; changed: boolean } {
  let accepted = 0;
  let duplicated = 0;
  let changed = false;
  db.transaction((tx) => {
    for (const s of samples) {
      const existing = tx
        .select()
        .from(healthMetrics)
        .where(and(eq(healthMetrics.metricType, s.metricType), eq(healthMetrics.startDate, s.startDate), eq(healthMetrics.endDate, s.endDate)))
        .get();
      if (existing) {
        duplicated++;
        if (existing.value !== s.value || existing.unit !== s.unit || existing.sourceName !== s.sourceName) changed = true;
        tx.update(healthMetrics).set({ value: s.value, unit: s.unit, sourceName: s.sourceName }).where(eq(healthMetrics.id, existing.id)).run();
      } else {
        tx.insert(healthMetrics).values({ ...s, createdAt: new Date() }).run();
        accepted++;
        changed = true;
      }
    }
  });
  return { accepted, duplicated, changed };
}

export function listMetrics(opts: { metricType?: HealthMetricType; from?: Date; to?: Date; limit?: number } = {}): HealthMetric[] {
  const conds = [
    opts.metricType ? eq(healthMetrics.metricType, opts.metricType) : undefined,
    opts.from ? gte(healthMetrics.startDate, opts.from) : undefined,
    opts.to ? lte(healthMetrics.startDate, opts.to) : undefined,
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(healthMetrics)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(healthMetrics.startDate))
    .limit(opts.limit ?? 1000)
    .all()
    .map(toMetric);
}

// "Last night": every sleep row in the 24h ending at the latest one, summed.
function latestSleep(): HealthMetric | undefined {
  const rows = db.select().from(healthMetrics).where(eq(healthMetrics.metricType, "sleepAsleep")).orderBy(desc(healthMetrics.endDate)).limit(50).all();
  const latest = rows[0];
  if (!latest) return undefined;
  const windowStart = latest.endDate.getTime() - 24 * 3_600_000;
  const night = rows.filter((r) => r.endDate.getTime() >= windowStart);
  const seconds = night.reduce((sum, r) => sum + (r.endDate.getTime() - r.startDate.getTime()) / 1000, 0);
  return { ...toMetric(latest), value: seconds, unit: "s", startDate: night[night.length - 1]!.startDate.toISOString() };
}

export function latestMetrics(): HealthLatest {
  const out: HealthLatest = {};
  for (const type of HEALTH_METRIC_TYPES) {
    const m = type === "sleepAsleep" ? latestSleep() : listMetrics({ metricType: type, limit: 1 })[0];
    if (m) out[type] = m;
  }
  return out;
}

export const countMetrics = () => Number(db.select({ n: sql<number>`count(*)` }).from(healthMetrics).get()?.n ?? 0);

export type HealthSettings = typeof settings.$inferSelect;

export function getHealthSettings(): HealthSettings {
  return db.select().from(settings).where(eq(settings.id, 1)).get() ?? { id: 1, ingestToken: null, lastIngestAt: null, publishEvents: false };
}

export function updateHealthSettings(patch: Partial<Omit<HealthSettings, "id">>): HealthSettings {
  const next = { ...getHealthSettings(), ...patch, id: 1 };
  db.insert(settings).values(next).onConflictDoUpdate({ target: settings.id, set: next }).run();
  return next;
}
