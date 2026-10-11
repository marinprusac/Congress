import { describe, expect, it } from "vitest";
import { EXHIBIT_ICONS, normalizeExhibitIcon } from "./exhibitIcons.js";
import { operationSchema } from "./typeDefinition.js";

describe("exhibit icons", () => {
  it("has no duplicate names, all kebab-case", () => {
    expect(new Set(EXHIBIT_ICONS).size).toBe(EXHIBIT_ICONS.length);
    for (const name of EXHIBIT_ICONS) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps known names, maps pre-lucide names, and falls back to file", () => {
    expect(normalizeExhibitIcon("dumbbell")).toBe("dumbbell");
    expect(normalizeExhibitIcon("note")).toBe("sticky-note");
    expect(normalizeExhibitIcon("fitness")).toBe("dumbbell");
    expect(normalizeExhibitIcon("no-such-icon")).toBe("file");
    expect(normalizeExhibitIcon("")).toBe("file");
    expect(normalizeExhibitIcon(undefined)).toBe("file");
  });

  it("only lets operations set an icon from the list", () => {
    expect(operationSchema.safeParse({ op: "set_type_meta", icon: "book-open" }).success).toBe(true);
    expect(operationSchema.safeParse({ op: "create_type", slug: "book", label: "Book", icon: "book" }).success).toBe(true);
    expect(operationSchema.safeParse({ op: "set_type_meta", icon: "not-an-icon" }).success).toBe(false);
    expect(operationSchema.safeParse({ op: "create_type", slug: "book", label: "Book", icon: "note" }).success).toBe(false);
  });
});
