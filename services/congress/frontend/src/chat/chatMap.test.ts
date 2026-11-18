import { describe, expect, it } from "vitest";
import { mapPoints, parseChatMap } from "./chatMap";

describe("a map block", () => {
  it("parses markers, paths and circles, and frames every point", () => {
    const spec = parseChatMap(JSON.stringify({ markers: [{ lat: 45.8, lng: 15.97, label: "Cafe" }], paths: [[[45.8, 15.97], [45.81, 15.98]]], circles: [{ lat: 45.9, lng: 16, radius: 100 }] }))!;
    expect(spec.height).toBe(240);
    expect(mapPoints(spec)).toEqual([[45.8, 15.97], [45.8, 15.97], [45.81, 15.98], [45.9, 16]]);
  });

  it("is null for half-streamed or invalid JSON, empty maps and impossible coordinates", () => {
    expect(parseChatMap('{"markers":[{"lat":45.8,')).toBeNull();
    expect(parseChatMap("{}")).toBeNull();
    expect(parseChatMap('{"markers":[{"lat":95,"lng":0}]}')).toBeNull();
    expect(parseChatMap('{"paths":[[[45.8,15.97]]]}')).toBeNull();
    expect(parseChatMap('{"circles":[{"lat":1,"lng":1,"radius":-5}]}')).toBeNull();
    expect(parseChatMap("[1,2]")).toBeNull();
  });
});
