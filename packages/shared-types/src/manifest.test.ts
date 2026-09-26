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

  it("accepts a full-screen view, a card-only view, and creatable exhibit types", () => {
    const parsed = manifestSchema.parse({
      ...base,
      views: [{ id: "agenda", label: "Agenda", fullPath: "/" }, { id: "snapshot", label: "Snapshot", card: true }],
      exhibitTypes: [{ type: "note", label: "Note", createPath: "/new" }],
    });
    expect(parsed.views[0]?.fullPath).toBe("/");
    expect(parsed.views[1]?.card).toBe(true);
    expect(parsed.exhibitTypes[0]?.createPath).toBe("/new");
  });

  it("rejects a view with neither a card nor a full-screen page - there'd be nothing to show", () => {
    expect(manifestSchema.safeParse({ ...base, views: [{ id: "list", label: "Open tasks" }] }).success).toBe(false);
  });

  it("rejects Chamber paths that aren't Chamber-relative", () => {
    expect(manifestSchema.safeParse({ ...base, views: [{ id: "x", label: "X", fullPath: "agenda" }] }).success).toBe(false);
    expect(manifestSchema.safeParse({ ...base, exhibitTypes: [{ type: "note", label: "Note", createPath: "new" }] }).success).toBe(false);
  });
});
