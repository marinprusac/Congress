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
    settingsFor("tasks.due_soon", { recordToHistory: true, historyMinPriority: "normal" });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon", minPriority: "normal" }]);
  });

  it("subscribes to a type that only notifies", () => {
    settingsFor("tasks.due_soon", { notify: true, notifyMinPriority: "high" });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon", minPriority: "high" }]);
  });

  it("asks for the loosest of the two thresholds when both actions are on", () => {
    // Congress's gate has to be at least as permissive as the loosest thing
    // this Chamber might do with the event; the precise per-action check
    // happens after delivery.
    settingsFor("tasks.due_soon", {
      recordToHistory: true,
      historyMinPriority: "low",
      notify: true,
      notifyMinPriority: "urgent",
    });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon", minPriority: "low" }]);
  });

  it("ignores the threshold of an action that is switched off", () => {
    // A disabled notify action's "low" must not widen the gate for a
    // recording action that only wants urgent events.
    settingsFor("tasks.due_soon", {
      recordToHistory: true,
      historyMinPriority: "urgent",
      notify: false,
      notifyMinPriority: "low",
    });
    expect(computeSubscriptions()).toEqual([{ type: "tasks.due_soon", minPriority: "urgent" }]);
  });

  it("returns one entry per active event type", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true, historyMinPriority: "low" });
    settingsFor("tasks.overdue", { notify: true, notifyMinPriority: "high" });
    settingsFor("notes.created");

    expect(computeSubscriptions().sort((a, b) => a.type.localeCompare(b.type))).toEqual([
      { type: "tasks.due_soon", minPriority: "low" },
      { type: "tasks.overdue", minPriority: "high" },
    ]);
  });

  it("never uses a wildcard - this Chamber always knows exactly which types it wants", () => {
    settingsFor("tasks.due_soon", { recordToHistory: true });
    expect(computeSubscriptions().some((s) => s.type === "*")).toBe(false);
  });
});
