import { describe, expect, it } from "vitest";
import { normalizeHealthAutoExportPayload, parseHealthAutoExportDate } from "./normalize.js";
import type { HealthIngestRequest } from "../types.js";

describe("parseHealthAutoExportDate", () => {
  it("parses the app's space-separated, non-colon-offset date format", () => {
    const parsed = parseHealthAutoExportDate("2026-08-16 00:00:00 +0200");
    expect(parsed.toISOString()).toBe("2026-08-15T22:00:00.000Z");
  });
});

// Fixtures here are the unwrapped shape (`{metrics: [...]}`) - the schema's
// preprocess step (types.ts) strips an outer `{"data": {...}}` envelope
// before normalizeHealthAutoExportPayload ever sees the payload, so that
// wrapping/unwrapping is exercised at the schema/route level (see
// ingest.test.ts's route tests) rather than duplicated here.
describe("normalizeHealthAutoExportPayload", () => {
  it("maps vo2_max to an instantaneous vo2Max sample", () => {
    const payload: HealthIngestRequest = {
      metrics: [
        {
          name: "vo2_max",
          units: "ml/(kg·min)",
          data: [{ date: "2026-08-16 00:00:00 +0200", qty: 37.75, source: "Marin’s Apple Watch" }],
        },
      ],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(skipped).toBe(0);
    expect(samples).toEqual([
      {
        metricType: "vo2Max",
        value: 37.75,
        unit: "ml/(kg·min)",
        startDate: parseHealthAutoExportDate("2026-08-16 00:00:00 +0200"),
        endDate: parseHealthAutoExportDate("2026-08-16 00:00:00 +0200"),
        sourceName: "Marin’s Apple Watch",
      },
    ]);
  });

  it("converts active_energy from kJ to kcal", () => {
    const payload: HealthIngestRequest = {
      metrics: [
        {
          name: "active_energy",
          units: "kJ",
          data: [{ date: "2026-08-09 00:00:00 +0200", qty: 4184, source: "Marin’s Apple Watch" }],
        },
      ],
    };
    const { samples } = normalizeHealthAutoExportPayload(payload);
    expect(samples[0]?.value).toBeCloseTo(1000);
    expect(samples[0]?.unit).toBe("kcal");
  });

  it("passes active_energy through unchanged when already in kcal", () => {
    const payload: HealthIngestRequest = {
      metrics: [{ name: "active_energy", units: "kcal", data: [{ date: "2026-08-09 00:00:00 +0200", qty: 500 }] }],
    };
    const { samples } = normalizeHealthAutoExportPayload(payload);
    expect(samples[0]?.value).toBe(500);
    expect(samples[0]?.unit).toBe("kcal");
  });

  it("derives sleepAsleep's value from totalSleep (hours -> seconds), using sleepStart/sleepEnd as the interval", () => {
    const payload: HealthIngestRequest = {
      metrics: [
        {
          name: "sleep_analysis",
          data: [
            {
              date: "2026-08-09 00:00:00 +0200",
              totalSleep: 6.0597452428936958,
              sleepStart: "2026-08-09 07:17:07 +0200",
              sleepEnd: "2026-08-09 13:33:08 +0200",
              inBedStart: "2026-08-09 07:17:07 +0200",
              inBedEnd: "2026-08-09 13:33:08 +0200",
              source: "Marin’s Apple Watch",
            },
          ],
        },
      ],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(skipped).toBe(0);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.metricType).toBe("sleepAsleep");
    expect(samples[0]?.unit).toBe("s");
    expect(samples[0]?.value).toBeCloseTo(6.0597452428936958 * 3600);
    expect(samples[0]?.startDate).toEqual(parseHealthAutoExportDate("2026-08-09 07:17:07 +0200"));
    expect(samples[0]?.endDate).toEqual(parseHealthAutoExportDate("2026-08-09 13:33:08 +0200"));
  });

  it("skips a sleep_analysis entry missing totalSleep/sleepStart/sleepEnd", () => {
    const payload: HealthIngestRequest = {
      metrics: [{ name: "sleep_analysis", data: [{ date: "2026-08-09 00:00:00 +0200", source: "x" }] }],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(samples).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips every entry of a metric type we don't track (e.g. resting_heart_rate), without erroring", () => {
    const payload: HealthIngestRequest = {
      metrics: [
        {
          name: "resting_heart_rate",
          units: "count/min",
          data: [
            { date: "2026-08-09 00:00:00 +0200", qty: 52 },
            { date: "2026-08-10 00:00:00 +0200", qty: 80 },
          ],
        },
      ],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(samples).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("skips a quantity entry missing qty or date", () => {
    const payload: HealthIngestRequest = {
      metrics: [{ name: "vo2_max", units: "ml/(kg·min)", data: [{ source: "x" }] }],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(samples).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("handles a full multi-metric export, ignoring untracked metrics", () => {
    const payload: HealthIngestRequest = {
      metrics: [
        { name: "vo2_max", units: "ml/(kg·min)", data: [{ date: "2026-08-16 00:00:00 +0200", qty: 37.75 }] },
        { name: "active_energy", units: "kJ", data: [{ date: "2026-08-09 00:00:00 +0200", qty: 1488.32 }] },
        { name: "resting_heart_rate", units: "count/min", data: [{ date: "2026-08-09 00:00:00 +0200", qty: 52 }] },
      ],
    };
    const { samples, skipped } = normalizeHealthAutoExportPayload(payload);
    expect(samples.map((s) => s.metricType).sort()).toEqual(["activeEnergy", "vo2Max"]);
    expect(skipped).toBe(1);
  });
});
