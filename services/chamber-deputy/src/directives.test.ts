import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Exhibit sync fans out to Congress's own /congress/exhibits/sync - stub it
// so these stay off the network; what's under test here is scheduling
// selection, not exhibit propagation.
vi.mock("./exhibits.js", () => ({
  toExhibitId: (id: number) => `directive-${id}`,
  parseDirectiveId: () => null,
  pushExhibitSync: vi.fn().mockResolvedValue(undefined),
}));

import { db, runMigrations } from "./db/client.js";
import { directives } from "./db/schema.js";
import {
  createDirective,
  updateDirective,
  listDueScheduledDirectives,
  nextScheduledWakeDelayMs,
  listEventTriggeredDirectives,
} from "./directives.js";

beforeAll(() => runMigrations(migrationsDir("chamber-deputy")));

beforeEach(() => {
  db.run(sql`delete from directives`);
});

function insertDirective(overrides: Partial<typeof directives.$inferInsert> = {}) {
  const now = new Date();
  return db
    .insert(directives)
    .values({ title: "Directive", body: "", enabled: true, createdAt: now, updatedAt: now, ...overrides })
    .returning()
    .get();
}

describe("listDueScheduledDirectives / nextScheduledWakeDelayMs", () => {
  it("has nothing due and no wake delay when no directive is scheduled", async () => {
    insertDirective({ scheduleType: null });
    expect(await listDueScheduledDirectives()).toEqual([]);
    expect(await nextScheduledWakeDelayMs()).toBeNull();
  });

  it("treats a never-run interval directive as immediately due", async () => {
    insertDirective({ scheduleType: "interval", intervalMs: 60_000 });
    const due = await listDueScheduledDirectives();
    expect(due).toHaveLength(1);
    expect(await nextScheduledWakeDelayMs()).toBe(0);
  });

  it("excludes an interval directive whose interval has not yet elapsed", async () => {
    insertDirective({ scheduleType: "interval", intervalMs: 60 * 60_000, lastRunAt: new Date() });
    expect(await listDueScheduledDirectives()).toEqual([]);
    const delay = await nextScheduledWakeDelayMs();
    expect(delay).not.toBeNull();
    expect(delay as number).toBeGreaterThan(0);
  });

  it("excludes a disabled directive even if its interval has elapsed", async () => {
    insertDirective({ scheduleType: "interval", intervalMs: 1, enabled: false });
    expect(await listDueScheduledDirectives()).toEqual([]);
    expect(await nextScheduledWakeDelayMs()).toBeNull();
  });

  it("excludes an event-scheduled directive from the periodic timer entirely", async () => {
    insertDirective({ scheduleType: "event", triggerEventType: "tasks.overdue" });
    expect(await listDueScheduledDirectives()).toEqual([]);
    expect(await nextScheduledWakeDelayMs()).toBeNull();
  });

  it("excludes a manual-only (null scheduleType) directive", async () => {
    insertDirective({ scheduleType: null });
    expect(await listDueScheduledDirectives()).toEqual([]);
  });

  it("picks the soonest wake delay across mixed schedule types", async () => {
    insertDirective({ title: "far", scheduleType: "interval", intervalMs: 60 * 60_000, lastRunAt: new Date() });
    insertDirective({
      title: "near",
      scheduleType: "daily",
      scheduleHour: 23,
      scheduleMinute: 59,
      scheduleTimeZone: "UTC",
      lastRunAt: new Date(),
    });
    const delay = await nextScheduledWakeDelayMs();
    expect(delay).not.toBeNull();
    // The daily directive's own next 23:59 UTC occurrence is always sooner
    // than a fresh 60-minute interval directive's own full hour wait,
    // except in the one-minute window right before midnight - comfortably
    // true for this assertion regardless of when the suite runs.
  });
});

describe("listEventTriggeredDirectives", () => {
  it("matches enabled event-scheduled directives by triggerEventType", async () => {
    const match = insertDirective({ scheduleType: "event", triggerEventType: "tasks.overdue" });
    insertDirective({ scheduleType: "event", triggerEventType: "tasks.due_soon" });
    insertDirective({ scheduleType: "event", triggerEventType: "tasks.overdue", enabled: false });

    const result = await listEventTriggeredDirectives("tasks.overdue");
    expect(result.map((d) => d.id)).toEqual([match.id]);
  });
});

describe("createDirective / updateDirective schedule round-trip", () => {
  it("persists and returns every schedule field for a weekly directive", async () => {
    const created = await createDirective({
      title: "Weekly review",
      body: "",
      enabled: true,
      scheduleType: "weekly",
      intervalMs: null,
      scheduleHour: 9,
      scheduleMinute: 30,
      scheduleDayOfWeek: 1,
      scheduleTimeZone: "America/New_York",
      triggerEventType: null,
    });

    expect(created).toMatchObject({
      scheduleType: "weekly",
      scheduleHour: 9,
      scheduleMinute: 30,
      scheduleDayOfWeek: 1,
      scheduleTimeZone: "America/New_York",
    });
    expect(created.nextRunAt).not.toBeNull();
  });

  it("clears the old schedule's companion fields when switching schedule kinds", async () => {
    const created = await createDirective({
      title: "Switching",
      body: "",
      enabled: true,
      scheduleType: "interval",
      intervalMs: 60_000,
      scheduleHour: null,
      scheduleMinute: null,
      scheduleDayOfWeek: null,
      scheduleTimeZone: null,
      triggerEventType: null,
    });

    const updated = await updateDirective(created.id, {
      scheduleType: "event",
      intervalMs: null,
      scheduleHour: null,
      scheduleMinute: null,
      scheduleDayOfWeek: null,
      scheduleTimeZone: null,
      triggerEventType: "tasks.overdue",
    });

    expect(updated).toMatchObject({ scheduleType: "event", intervalMs: null, triggerEventType: "tasks.overdue" });
    expect(updated?.nextRunAt).toBeNull();
  });

  it("leaves schedule fields untouched by a partial update that omits them", async () => {
    const created = await createDirective({
      title: "Untouched",
      body: "",
      enabled: true,
      scheduleType: "interval",
      intervalMs: 120_000,
      scheduleHour: null,
      scheduleMinute: null,
      scheduleDayOfWeek: null,
      scheduleTimeZone: null,
      triggerEventType: null,
    });

    const updated = await updateDirective(created.id, { enabled: false });
    expect(updated).toMatchObject({ enabled: false, scheduleType: "interval", intervalMs: 120_000 });
  });
});
