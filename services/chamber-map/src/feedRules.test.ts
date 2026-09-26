import { describe, expect, it } from "vitest";
import type { Visit } from "./types.js";
import { mapFeedCandidates } from "./feedRules.js";

function visit(id: number, overrides: Partial<Visit> = {}): Visit {
  return {
    id,
    placeId: null,
    placeName: null,
    status: "confirmed",
    adhocLabel: null,
    clusterLatitude: null,
    clusterLongitude: null,
    latitude: null,
    longitude: null,
    arrivedAt: "2026-09-27T08:00:00.000Z",
    departedAt: "2026-09-27T09:00:00.000Z",
    durationMinutes: 60,
    ...overrides,
  };
}

describe("mapFeedCandidates", () => {
  it("raises the classify card while stays are waiting", () => {
    const items = mapFeedCandidates({ pending: [visit(1, { status: "pending" }), visit(2, { status: "pending" })], today: [] });
    expect(items).toContainEqual({ kind: "view", viewId: "pending", score: 60, reason: "2 to classify" });
  });

  it("sinks every card on an empty day", () => {
    const items = mapFeedCandidates({ pending: [], today: [] });
    expect(items).toEqual([
      { kind: "view", viewId: "pending", score: 5 },
      { kind: "view", viewId: "today-map", score: 15 },
    ]);
  });

  it("surfaces the place the owner is at right now, not ones already left", () => {
    const items = mapFeedCandidates({
      pending: [],
      today: [visit(1, { placeId: 3 }), visit(2, { placeId: 7, departedAt: null })],
    });
    expect(items).toContainEqual({ kind: "view", viewId: "today-map", score: 35, reason: "2 places today" });
    expect(items.filter((i) => i.kind === "exhibit")).toEqual([{ kind: "exhibit", exhibitId: "place-7", score: 45, reason: "You're here" }]);
  });

  it("doesn't count an ignored or still-pending stay as a place visited today", () => {
    const items = mapFeedCandidates({ pending: [], today: [visit(1, { status: "ignored" }), visit(2, { status: "pending", departedAt: null, placeId: 4 })] });
    expect(items).toContainEqual({ kind: "view", viewId: "today-map", score: 15 });
    expect(items.some((i) => i.kind === "exhibit")).toBe(false);
  });
});
