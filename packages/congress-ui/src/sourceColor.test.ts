import { describe, expect, it } from "vitest";
import { hashSourceColor } from "@congress/shared-types";
import { pickSourceColor, sourceColorStyle } from "./sourceColor.js";

describe("pickSourceColor", () => {
  const colors = new Map([["event", "cobalt"], ["broken", "chartreuse"]]);

  it("uses a record type's stored colour", () => {
    expect(pickSourceColor("e", "event", colors)).toBe("cobalt");
  });

  it("derives a stable colour for a type without one", () => {
    expect(pickSourceColor("e", "recipe", colors)).toBe(hashSourceColor("recipe"));
    expect(pickSourceColor("e", "recipe", colors)).toBe(pickSourceColor("e", "recipe", new Map()));
  });

  it("ignores a stored value that is not in the palette", () => {
    expect(pickSourceColor("e", "broken", colors)).toBe(hashSourceColor("broken"));
  });

  it("gives non-record sources their fixed colour, and unknown ones ink", () => {
    expect(pickSourceColor("events", undefined, colors)).toBe("cobalt");
    expect(pickSourceColor("map", undefined, colors)).toBe("lilac");
    expect(pickSourceColor("somethingnew", undefined, colors)).toBe("ink");
    expect(pickSourceColor("e", undefined, colors)).toBe("ink");
  });
});

describe("sourceColorStyle", () => {
  it("pairs each fill with a readable text colour", () => {
    expect(sourceColorStyle("cobalt")).toMatchObject({ "--src": "var(--color-src-cobalt)", "--on-src": "var(--on-src-cobalt)" });
    expect(sourceColorStyle("mint")).toMatchObject({ "--on-src": "#111110" });
  });
});
