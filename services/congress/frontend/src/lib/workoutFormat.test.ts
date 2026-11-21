import { describe, expect, it } from "vitest";
import { formatSet } from "./workoutFormat";

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
