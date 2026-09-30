import { describe, expect, it } from "vitest";
import { closeness, formatDuration, plainTextPreview } from "./feedText.js";

describe("plainTextPreview", () => {
  it("turns exhibit chips into their labels and drops markdown markers", () => {
    expect(plainTextPreview("# Plan\n- pack for [[exhibit:notes:note-4|Trip plan]]\n- **book** the `taxi`")).toBe("Plan pack for Trip plan book the taxi");
  });

  it("returns nothing for an empty or whitespace-only body", () => {
    expect(plainTextPreview("")).toBeUndefined();
    expect(plainTextPreview("  \n ")).toBeUndefined();
    expect(plainTextPreview(null)).toBeUndefined();
  });

  it("cuts a long body at a word boundary", () => {
    const out = plainTextPreview("alpha beta gamma delta epsilon", 17)!;
    expect(out).toBe("alpha beta gamma…");
  });
});

describe("formatDuration / closeness", () => {
  it("phrases durations coarsely", () => {
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(-2 * 3_600_000)).toBe("2 h");
    expect(formatDuration(3 * 86_400_000)).toBe("3 days");
  });

  it("scales closeness linearly within the window", () => {
    expect(closeness(0, 100)).toBe(1);
    expect(closeness(50, 100)).toBe(0.5);
    expect(closeness(150, 100)).toBe(0);
  });
});
