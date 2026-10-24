import { describe, expect, it } from "vitest";
import { stripTitlePrefix, withTitlePrefix } from "./titlePrefix.js";

describe("title prefix", () => {
  it("adds the type label once", () => {
    expect(withTitlePrefix("Work Session", "23 October")).toBe("Work Session: 23 October");
    expect(withTitlePrefix("Work Session", "Work Session: 23 October")).toBe("Work Session: 23 October");
  });
  it("leaves empty titles empty", () => {
    expect(withTitlePrefix("Note", "  ")).toBe("");
    expect(withTitlePrefix("Note", "Note: ")).toBe("");
  });
  it("strips only a leading prefix", () => {
    expect(stripTitlePrefix("Note", "Note: hi")).toBe("hi");
    expect(stripTitlePrefix("Note", "Other: Note: hi")).toBe("Other: Note: hi");
  });
});
