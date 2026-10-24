import { describe, expect, it } from "vitest";
import { RECORD_ICONS, normalizeRecordIcon } from "./recordIcons.js";
import { operationSchema } from "./typeDefinition.js";

describe("record icons", () => {
  it("has no duplicate names, all kebab-case", () => {
    expect(new Set(RECORD_ICONS).size).toBe(RECORD_ICONS.length);
    for (const name of RECORD_ICONS) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps known names, maps pre-lucide names, and falls back to file", () => {
    expect(normalizeRecordIcon("dumbbell")).toBe("dumbbell");
    expect(normalizeRecordIcon("note")).toBe("sticky-note");
    expect(normalizeRecordIcon("fitness")).toBe("dumbbell");
    expect(normalizeRecordIcon("no-such-icon")).toBe("file");
    expect(normalizeRecordIcon("")).toBe("file");
    expect(normalizeRecordIcon(undefined)).toBe("file");
  });

  it("only lets operations set an icon from the list", () => {
    expect(operationSchema.safeParse({ op: "set_type_meta", icon: "book-open" }).success).toBe(true);
    expect(operationSchema.safeParse({ op: "create_type", slug: "book", label: "Book", icon: "book" }).success).toBe(true);
    expect(operationSchema.safeParse({ op: "set_type_meta", icon: "not-an-icon" }).success).toBe(false);
    expect(operationSchema.safeParse({ op: "create_type", slug: "book", label: "Book", icon: "note" }).success).toBe(false);
  });
});
