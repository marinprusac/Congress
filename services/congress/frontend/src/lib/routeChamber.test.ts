import { describe, expect, it } from "vitest";
import { chamberForPath } from "./routeChamber.js";

describe("chamberForPath", () => {
  it("names the Chamber of a Chamber route", () => {
    expect(chamberForPath("/notes/n/1")).toBe("notes");
    expect(chamberForPath("/calendar")).toBe("calendar");
    expect(chamberForPath("/tasks/t/2?x=1#top")).toBe("tasks");
  });

  it("names the Chamber behind a view page", () => {
    expect(chamberForPath("/view/map/today")).toBe("map");
    expect(chamberForPath("/view")).toBeUndefined();
  });

  it("ignores the shell's own routes", () => {
    for (const path of ["/", "", "/search", "/chat/12", "/notifications", "/settings?tab=ai", "/capitol/x", "/logs"]) {
      expect(chamberForPath(path)).toBeUndefined();
    }
  });
});
