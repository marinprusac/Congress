import { migrationsDir } from "@congress/test-support";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { widgetLayouts } from "./db/schema.js";
import { deletePlacement, listPlacements, upsertPlacement } from "./layout.js";

beforeAll(() => runMigrations(migrationsDir("chamber-capitol")));

beforeEach(() => {
  db.run(sql`delete from widget_layouts`);
});

describe("upsertPlacement", () => {
  it("inserts a new placement and returns it", () => {
    const result = upsertPlacement("desktop", "notes", "recent-notes", 0, 0);
    expect(result).toEqual({ chamber: "notes", widgetId: "recent-notes", x: 0, y: 0 });
    expect(listPlacements("desktop")).toEqual([{ chamber: "notes", widgetId: "recent-notes", x: 0, y: 0 }]);
  });

  it("moves the same (scope, chamber, widgetId) in place rather than inserting a second row", () => {
    upsertPlacement("desktop", "notes", "recent-notes", 0, 0);
    const result = upsertPlacement("desktop", "notes", "recent-notes", 2, 3);

    expect(result).toEqual({ chamber: "notes", widgetId: "recent-notes", x: 2, y: 3 });
    expect(db.select().from(widgetLayouts).all()).toHaveLength(1);
    expect(listPlacements("desktop")).toEqual([{ chamber: "notes", widgetId: "recent-notes", x: 2, y: 3 }]);
  });

  it("returns null and writes nothing when a different chamber's widget already occupies the cell in the same scope", () => {
    upsertPlacement("desktop", "notes", "recent-notes", 0, 0);
    const result = upsertPlacement("desktop", "tasks", "due-soon", 0, 0);

    expect(result).toBeNull();
    expect(listPlacements("desktop")).toEqual([{ chamber: "notes", widgetId: "recent-notes", x: 0, y: 0 }]);
  });

  it("returns null and writes nothing when the same chamber's other widget already occupies the cell (auto-place race)", () => {
    upsertPlacement("desktop", "notes", "a", 0, 0);
    const result = upsertPlacement("desktop", "notes", "b", 0, 0);

    expect(result).toBeNull();
    expect(listPlacements("desktop")).toEqual([{ chamber: "notes", widgetId: "a", x: 0, y: 0 }]);
  });

  it("does not treat a widget's own current cell as a conflict against itself", () => {
    upsertPlacement("desktop", "notes", "a", 0, 0);
    const result = upsertPlacement("desktop", "notes", "a", 0, 0);
    expect(result).toEqual({ chamber: "notes", widgetId: "a", x: 0, y: 0 });
  });

  it("scopes the conflict check per scope: the same cell in a different scope does not block", () => {
    upsertPlacement("desktop", "notes", "recent-notes", 0, 0);
    const result = upsertPlacement("mobile", "tasks", "due-soon", 0, 0);

    expect(result).toEqual({ chamber: "tasks", widgetId: "due-soon", x: 0, y: 0 });
  });

  it("is origin-cell-only, not footprint-aware: two widgets at different origins never conflict even if a real footprint might overlap", () => {
    const a = upsertPlacement("desktop", "notes", "a", 0, 0);
    const b = upsertPlacement("desktop", "tasks", "b", 1, 0);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});

describe("deletePlacement", () => {
  it("removes exactly the targeted (scope, chamber, widgetId) row and leaves others untouched", () => {
    upsertPlacement("desktop", "notes", "a", 0, 0);
    upsertPlacement("desktop", "notes", "b", 1, 0);
    upsertPlacement("desktop", "tasks", "a", 2, 0);

    deletePlacement("desktop", "notes", "a");

    expect(listPlacements("desktop")).toEqual([
      { chamber: "notes", widgetId: "b", x: 1, y: 0 },
      { chamber: "tasks", widgetId: "a", x: 2, y: 0 },
    ]);
  });

  it("is a silent no-op for a placement that doesn't exist", () => {
    expect(() => deletePlacement("desktop", "notes", "nonexistent")).not.toThrow();
  });
});
