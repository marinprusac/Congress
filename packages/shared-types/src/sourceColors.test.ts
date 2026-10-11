import { describe, expect, it } from "vitest";
import { hashSourceColor, isSourceColor, SOURCE_COLORS } from "./sourceColors.js";
import { operationSchema, typeDefinitionSchema } from "./typeDefinition.js";

describe("source colours", () => {
  it("hashes a slug to the same bright colour every time, never ink", () => {
    for (const slug of ["note", "recipe", "wine-cellar", "x"]) {
      expect(hashSourceColor(slug)).toBe(hashSourceColor(slug));
      expect(hashSourceColor(slug)).not.toBe("ink");
      expect(isSourceColor(hashSourceColor(slug))).toBe(true);
    }
  });

  it("spreads different slugs over more than one colour", () => {
    const seen = new Set(["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "gggggggg"].map(hashSourceColor));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("accepts only palette keys on the operations", () => {
    for (const color of SOURCE_COLORS) {
      expect(operationSchema.safeParse({ op: "set_type_meta", color }).success).toBe(true);
    }
    expect(operationSchema.safeParse({ op: "set_type_meta", color: "#ff0000" }).success).toBe(false);
    expect(operationSchema.safeParse({ op: "create_type", slug: "gizmo", label: "Gizmo", color: "mint" }).success).toBe(true);
  });

  it("loads a stored definition that predates colours", () => {
    const base = {
      slug: "note", label: "Note", pluralLabel: "Notes", icon: "file", tableName: "x_note", titleField: null, fields: [],
      layout: { body: null }, actions: [], feedRules: [], eventPrefix: "note", hidden: false,
    };
    expect(typeDefinitionSchema.parse(base).color).toBeUndefined();
    expect(typeDefinitionSchema.parse({ ...base, color: "tomato" }).color).toBe("tomato");
  });
});
