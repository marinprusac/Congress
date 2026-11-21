import { describe, expect, it } from "vitest";
import { manifestSchema } from "./manifest.js";

const base = {
  name: "notes",
  displayName: "Notes",
  version: "0.1.0",
  routes: { home: "/notes", settings: "/notes/settings" },
};

describe("manifestSchema exhibitTypes", () => {
  it("defaults it to empty for a Chamber registering an older manifest", () => {
    const parsed = manifestSchema.parse(base);
    expect(parsed.exhibitTypes).toEqual([]);
  });

  it("accepts creatable record types", () => {
    const parsed = manifestSchema.parse({
      ...base,
      exhibitTypes: [{ type: "note", label: "Note", createPath: "/new" }],
    });
    expect(parsed.exhibitTypes[0]?.createPath).toBe("/new");
  });

  it("rejects Chamber paths that aren't Chamber-relative", () => {
    expect(manifestSchema.safeParse({ ...base, exhibitTypes: [{ type: "note", label: "Note", createPath: "new" }] }).success).toBe(false);
  });
});
