import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "./db/client.js";
import { eventSettings } from "./db/schema.js";
import { computeSubscriptions } from "./subscriptions.js";

beforeAll(() => runMigrations(migrationsDir("chamber-logs")));

beforeEach(() => {
  db.run(sql`delete from event_settings`);
});

function settingsFor(eventType: string, overrides: Partial<typeof eventSettings.$inferInsert> = {}) {
  db.insert(eventSettings)
    .values({
      eventType,
      chamber: "tasks",
      label: eventType,
      recordToHistory: false,
      notify: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .run();
}

// This list is what Congress relays on. Get it wrong and events stop
// arriving at all - and because Congress's own filter is only a coarse
// gate, nothing downstream can compensate for a type that was never sent.
describe("computeSubscriptions", () => {
  it("subscribes to nothing when no event type has an active action", () => {
    settingsFor("tasks.due_soon");
    settingsFor("tasks.overdue");
    expect(computeSubscriptions()).toEqual([]);
  });

  it("subscribes to a type that only records", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon" }]);
  });

  it("subscribes to a type that only notifies", () => {
    settingsFor("tasks.due_soon", { notify: true });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon" }]);
  });

  it("subscribes once when both actions are on", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, notify: true });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon" }]);
  });

  it("returns one entry per active event type", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    settingsFor("tasks.overdue", { notify: true });
    settingsFor("notes.created");

    expect(computeSubscriptions().sort((a, b) => a.type.localeCompare(b.type))).toEqual([
      { type: "tasks.due_soon" },
      { type: "tasks.overdue" },
    ]);
  });

  it("never uses a wildcard - this Chamber always knows exactly which types it wants", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    expect(computeSubscriptions().some((s) => s.type === "*")).toBe(false);
  });
});
