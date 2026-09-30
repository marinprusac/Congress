import { describe, expect, it } from "vitest";
import { formatSet, mergeCalories } from "./format";

const metric = (metricType: "activeEnergy" | "restingEnergy", startDate: string, value: number) => ({ id: 0, metricType, value, unit: "kcal", startDate, endDate: startDate, sourceName: null });

describe("mergeCalories", () => {
  it("adds a day's active and resting energy, newest day first", () => {
    const rows = mergeCalories([metric("activeEnergy", "2026-09-28", 500), metric("activeEnergy", "2026-09-29", 600)], [metric("restingEnergy", "2026-09-29", 1700)]);
    expect(rows).toEqual([
      { startDate: "2026-09-29", active: 600, resting: 1700 },
      { startDate: "2026-09-28", active: 500, resting: 0 },
    ]);
  });
});

describe("formatSet", () => {
  const set = { index: 0, weightKg: null, reps: null, durationSeconds: null, distanceMeters: null, oneRepMax: null };
  it("shows whatever the set measured", () => {
    expect(formatSet({ ...set, weightKg: 80, reps: 5 })).toBe("80 kg × 5");
    expect(formatSet({ ...set, reps: 12 })).toBe("12 reps");
    expect(formatSet({ ...set, durationSeconds: 95 })).toBe("1:35");
    expect(formatSet({ ...set, distanceMeters: 5200 })).toBe("5.20 km");
    expect(formatSet(set)).toBe("—");
  });
});
