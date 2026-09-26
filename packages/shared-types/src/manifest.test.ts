import { describe, expect, it } from "vitest";
import { manifestSchema } from "./manifest.js";

const base = {
  name: "notes",
  displayName: "Notes",
  version: "0.1.0",
  routes: { home: "/notes", settings: "/notes/settings" },
  apiBase: "http://127.0.0.1:8011/api",
  healthUrl: "http://127.0.0.1:8011/health",
};

describe("manifestSchema views/exhibitTypes", () => {
  it("defaults both to empty for a Chamber registering an older manifest", () => {
    const parsed = manifestSchema.parse(base);
    expect(parsed.views).toEqual([]);
    expect(parsed.exhibitTypes).toEqual([]);
  });

  it("accepts views with and without a full-screen path, and creatable exhibit types", () => {
    const parsed = manifestSchema.parse({
      ...base,
      views: [{ id: "pinned", label: "Pinned notes" }, { id: "all", label: "All", fullPath: "/" }],
      exhibitTypes: [{ type: "note", label: "Note", createPath: "/new" }],
    });
    expect(parsed.views[1]?.fullPath).toBe("/");
    expect(parsed.exhibitTypes[0]?.createPath).toBe("/new");
  });

  it("rejects Chamber paths that aren't Chamber-relative", () => {
    expect(manifestSchema.safeParse({ ...base, views: [{ id: "x", label: "X", fullPath: "agenda" }] }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...base, exhibitTypes: [{ type: "note", label: "Note", createPath: "new" }] }).success).toBe(false);
  });
});
