import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo.js";

// Every threshold in this Chamber is denominated in metres out of this one
// function - place radii, the unknown-dwell cluster, the gap-credit drift
// factor, trip distance. A change to it silently retunes all of them at once.
describe("haversineMeters", () => {
  it("is zero for a point against itself", () => {
    expect(haversineMeters({ latitude: 45, longitude: 9 }, { latitude: 45, longitude: 9 })).toBe(0);
  });

  it("measures a degree of latitude as ~111.2 km anywhere on the globe", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111_194.9, 0);
    expect(haversineMeters({ latitude: 60, longitude: 5 }, { latitude: 61, longitude: 5 })).toBeCloseTo(111_194.9, 0);
  });

  it("shortens a degree of longitude with the cosine of the latitude", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111_194.9, 0);
    expect(haversineMeters({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 })).toBeCloseTo(55_596.9, 0);
  });

  it("matches a known long-distance reference", () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    expect(haversineMeters(london, paris)).toBeCloseTo(343_556, -1);
  });

  it("is symmetric", () => {
    const a = { latitude: 12.3, longitude: -45.6 };
    const b = { latitude: -7.8, longitude: 90.1 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("resolves the small distances the dwell clustering actually works at", () => {
    // 0.001 degrees of latitude - roughly the scale of a cluster radius.
    expect(haversineMeters({ latitude: 45, longitude: 0 }, { latitude: 45.001, longitude: 0 })).toBeCloseTo(111.2, 1);
  });

  it("does not blow up at antipodes, where a naive acos formulation loses precision", () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })).toBeCloseTo(20_015_087, -2);
  });
});
