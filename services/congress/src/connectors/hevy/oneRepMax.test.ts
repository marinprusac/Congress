import { describe, expect, it } from "vitest";
import { computeOneRepMax } from "./oneRepMax.js";

describe("computeOneRepMax", () => {
  it("returns null when weight is missing", () => {
    expect(computeOneRepMax(null, 5)).toBeNull();
  });

  it("returns null when reps is missing", () => {
    expect(computeOneRepMax(100, null)).toBeNull();
  });

  it("returns null for a zero-rep set", () => {
    expect(computeOneRepMax(100, 0)).toBeNull();
  });

  it("returns null for a negative rep count", () => {
    expect(computeOneRepMax(100, -1)).toBeNull();
  });

  it("computes the Epley formula for a normal set", () => {
    expect(computeOneRepMax(100, 5)).toBeCloseTo(116.667, 2);
  });

  it("is slightly above the raw weight for a single rep", () => {
    expect(computeOneRepMax(100, 1)).toBeCloseTo(103.333, 2);
  });
});
