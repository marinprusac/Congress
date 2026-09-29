import { describe, expect, it } from "vitest";
import type { Visit } from "../../../src/types";
import { dayMarkers } from "./dayMarkers.js";

function visit(overrides: Partial<Visit>): Visit {
  return {
    id: 1,
    placeId: null,
    placeName: null,
    status: "confirmed",
    adhocLabel: null,
    clusterLatitude: null,
    clusterLongitude: null,
    latitude: 55.7,
    longitude: 13.2,
    arrivedAt: "2026-09-28T18:03:25.000Z",
    departedAt: null,
    durationMinutes: null,
    ...overrides,
  };
}

describe("dayMarkers", () => {
  // Regression: after midnight the Home card only saw visits arriving today,
  // so a night at home showed "Nowhere recorded yet today".
  it("shows the carried-over stay when the day has no visits of its own", () => {
    const home = visit({ id: 7, placeId: 5 });
    expect(dayMarkers([home])).toEqual([home]);
  });

  it("tolerates a missing carried-over stay", () => {
    expect(dayMarkers([null, undefined])).toEqual([]);
  });

  it("draws one marker per place, however many visits it had", () => {
    const first = visit({ id: 1, placeId: 5 });
    const second = visit({ id: 2, placeId: 5 });
    expect(dayMarkers([first, second])).toEqual([first]);
  });

  it("keeps separate unplaced visits apart", () => {
    const a = visit({ id: 1 });
    const b = visit({ id: 2 });
    expect(dayMarkers([a, b])).toEqual([a, b]);
  });

  it("skips ignored and location-less visits", () => {
    expect(dayMarkers([visit({ status: "ignored" }), visit({ latitude: null, longitude: null })])).toEqual([]);
  });
});
