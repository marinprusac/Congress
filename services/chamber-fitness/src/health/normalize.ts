import type { HealthIngestRequest, HealthMetricType } from "../types.js";

export interface NormalizedHealthSample {
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startDate: Date;
  endDate: Date;
  sourceName: string | null;
}

// Health Auto Export's own metric identifiers -> ours. Extend this map when
// turning on a new metric in the app's own export settings - an
// unrecognized name is skipped rather than rejected, since the export
// always includes every metric currently enabled there, not just the ones
// we track. weight_body_mass/basal_energy_burned are the app's documented
// naming convention but unverified against a real export - if Weight/
// Resting Energy don't show up after enabling them, check the real key
// name in an export and adjust this map.
const METRIC_NAME_MAP: Record<string, HealthMetricType> = {
  vo2_max: "vo2Max",
  weight_body_mass: "weight",
  active_energy: "activeEnergy",
  basal_energy_burned: "restingEnergy",
};

// Health Auto Export dates look like "2026-08-16 00:00:00 +0200" - valid
// almost-ISO8601, just space-separated instead of "T"-separated. Reformatted
// rather than handed to `new Date()` as-is, since that non-standard spacing
// isn't guaranteed to parse consistently across JS engines.
export function parseHealthAutoExportDate(value: string): Date {
  const isoish = value.replace(" ", "T").replace(/ (?=[+-]\d{4}$)/, "");
  return new Date(isoish);
}

// The app reports energy in whatever unit the Health app's own locale
// settings use - kJ or kcal - so a switched device/locale would otherwise
// silently change what's stored under the same metric type. Normalized to
// kcal here so a trend line never has a unit discontinuity in the middle.
function normalizeEnergy(qty: number, units: string | undefined): { value: number; unit: string } {
  if (units === "kJ") return { value: qty / 4.184, unit: "kcal" };
  return { value: qty, unit: units ?? "kcal" };
}

export function normalizeHealthAutoExportPayload(payload: HealthIngestRequest): {
  samples: NormalizedHealthSample[];
  skipped: number;
} {
  const samples: NormalizedHealthSample[] = [];
  let skipped = 0;

  for (const metric of payload.metrics) {
    // Sleep Analysis entries are pre-aggregated per night by the app itself
    // (totalSleep already excludes in-bed-but-awake time, regardless of
    // whether the source device reported sleep stages or just one lump
    // "Asleep" total) - so this is the one metric where we trust the
    // app-provided number directly rather than re-deriving anything from
    // an interval.
    if (metric.name === "sleep_analysis") {
      for (const entry of metric.data) {
        const totalSleep = entry.totalSleep;
        const sleepStart = entry.sleepStart;
        const sleepEnd = entry.sleepEnd;
        if (typeof totalSleep !== "number" || typeof sleepStart !== "string" || typeof sleepEnd !== "string") {
          skipped++;
          continue;
        }
        const startDate = parseHealthAutoExportDate(sleepStart);
        const endDate = parseHealthAutoExportDate(sleepEnd);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          skipped++;
          continue;
        }
        samples.push({
          metricType: "sleepAsleep",
          value: totalSleep * 3600,
          unit: "s",
          startDate,
          endDate,
          sourceName: typeof entry.source === "string" ? entry.source : null,
        });
      }
      continue;
    }

    const metricType = METRIC_NAME_MAP[metric.name];
    if (!metricType) {
      skipped += metric.data.length;
      continue;
    }

    for (const entry of metric.data) {
      const qty = entry.qty;
      const date = entry.date;
      if (typeof qty !== "number" || typeof date !== "string") {
        skipped++;
        continue;
      }
      const at = parseHealthAutoExportDate(date);
      if (Number.isNaN(at.getTime())) {
        skipped++;
        continue;
      }
      const { value, unit } =
        metricType === "activeEnergy" || metricType === "restingEnergy"
          ? normalizeEnergy(qty, metric.units)
          : { value: qty, unit: metric.units ?? "" };
      samples.push({
        metricType,
        value,
        unit,
        startDate: at,
        endDate: at,
        sourceName: typeof entry.source === "string" ? entry.source : null,
      });
    }
  }

  return { samples, skipped };
}
