import { z } from "zod";

// Health Auto Export's payload and the metrics kept from it (ported from the Fitness Chamber).

export const healthMetricTypeSchema = z.enum(["weight", "vo2Max", "activeEnergy", "restingEnergy", "sleepAsleep"]);
export type HealthMetricType = z.infer<typeof healthMetricTypeSchema>;
export const HEALTH_METRIC_TYPES = healthMetricTypeSchema.options;

const healthAutoExportMetricSchema = z.object({
  name: z.string(),
  units: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())),
});

const healthAutoExportBodySchema = z.object({ metrics: z.array(healthAutoExportMetricSchema).default([]) }).passthrough();

// The app wraps it in { data: ... } in some export versions.
export const healthIngestRequestSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && "data" in raw) return (raw as { data: unknown }).data;
  return raw;
}, healthAutoExportBodySchema);
export type HealthIngestRequest = z.infer<typeof healthAutoExportBodySchema>;

export interface HealthMetric {
  id: number;
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName: string | null;
}

export type HealthLatest = Partial<Record<HealthMetricType, HealthMetric>>;
