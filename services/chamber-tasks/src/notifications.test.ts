import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// createPublishEvent posts to Congress; the whole point of this Chamber's
// design is that it only publishes and never decides what happens next, so
// the publishes themselves are what these tests assert on.
// vi.hoisted, because vi.mock's factory is lifted above ordinary module-scope
// declarations and would otherwise close over an uninitialised binding.
const { publishSpy } = vi.hoisted(() => ({
  publishSpy: vi.fn<(event: { type: string; payload: Record<string, unknown> }) => Promise<void>>(),
}));

vi.mock("@congress/chamber-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@congress/chamber-kit")>()),
  createPublishEvent: () => publishSpy,
}));

import { db, runMigrations } from "./db/client.js";
import { tasks } from "./db/schema.js";
import { checkDueTasks, nextThresholdMs, stopDueTaskNotifications } from "./notifications.js";

// A task is due until its day ends in Zagreb (env.OWNER_TIMEZONE's default).
// March 2026 before the 29th is CET, +01:00.
const HOUR = 60 * 60 * 1000;
const midnight = (day: number) => Date.UTC(2026, 2, 1 + day) - HOUR;
const NOW = midnight(0) + 12 * HOUR;

beforeAll(() => runMigrations(migrationsDir("chamber-tasks")));

beforeEach(async () => {
  db.run(sql`delete from tasks`);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  // "What did I last publish for this task" is now persisted (dueNotifications
  // table), which outlives an individual test the same way the db itself
  // does. With no tasks left in the table, one check drains it.
  publishSpy.mockResolvedValue(undefined);
  await checkDueTasks();
  publishSpy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  stopDueTaskNotifications();
  vi.useRealTimers();
});

// Due `dueDay` days from today, stored as that day's local midnight (what the
// editor sends) - its deadline is midnight(dueDay + 1).
function task(name: string, dueDay: number | null, completed = false) {
  return db
    .insert(tasks)
    .values({
      name,
      dueDate: dueDay === null ? null : new Date(midnight(dueDay)),
      completed,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .returning()
    .get();
}

function published() {
  return publishSpy.mock.calls.map(([event]) => ({ type: event.type, taskId: event.payload.taskId }));
}

describe("nextThresholdMs", () => {
  // The timer is armed for exactly this instant rather than polling, so an
  // off-by-one here means an event fires at the wrong time or never.
  it("returns null when there is nothing upcoming", () => {
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("ignores a task with no due date", () => {
    task("someday", null);
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("ignores a completed task", () => {
    task("done", 2, true);
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("arms for the due-soon threshold of a task more than a day out", () => {
    // Two thresholds per task: deadline - 24h, and the deadline itself.
    task("later", 3);
    expect(nextThresholdMs(NOW)).toBe(midnight(3));
  });

  it("arms for the end of the due day once the due-soon threshold has passed", () => {
    task("today", 0);
    expect(nextThresholdMs(NOW)).toBe(midnight(1));
  });

  it("ignores a threshold that is already in the past", () => {
    // Anything already crossed is handled by the check that runs immediately
    // before the timer is re-armed.
    task("overdue", -1);
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("takes the soonest threshold across every task", () => {
    task("far", 10);
    task("near", 0);
    task("mid", 2);
    expect(nextThresholdMs(NOW)).toBe(midnight(1));
  });

  it("treats a threshold exactly at 'now' as passed, not upcoming", () => {
    task("boundary", 1);
    expect(nextThresholdMs(midnight(1))).toBe(midnight(2));
  });
});

describe("checkDueTasks", () => {
  it("publishes nothing when no task is within the lookahead window", async () => {
    task("later", 3);
    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("publishes due_soon for a task due today", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_soon", taskId: t.id }]);
  });

  it("publishes overdue for a task whose due day has ended", async () => {
    const t = task("late", -1);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: t.id }]);
  });

  it("reads a UTC-midnight due date (a bare date over MCP) as the same local day", async () => {
    const t = db
      .insert(tasks)
      .values({ name: "mcp", dueDate: new Date("2026-03-01"), completed: false, createdAt: new Date(NOW), updatedAt: new Date(NOW) })
      .returning()
      .get();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_soon", taskId: t.id }]);
    expect(nextThresholdMs(NOW)).toBe(midnight(1));
  });

  it("carries the name and a link in the payload, for a rule to template from", async () => {
    const t = task("Taxes", 0);
    await checkDueTasks();
    expect(publishSpy.mock.calls[0]![0].payload).toEqual({
      taskId: t.id,
      name: "Taxes",
      url: `/t/${t.id}`,
    });
  });

  it("ignores completed tasks entirely", async () => {
    task("done", -1, true);
    await checkDueTasks();
    expect(published()).toEqual([]);
  });
});

describe("state transitions", () => {
  // A publish is a push-relayed switch, not a durable record - re-publishing
  // an unchanged state on every check would flood the Logs Chamber's
  // append-only history and re-fire automations with no dedupe of their own.
  it("does not re-publish a state that has not changed", async () => {
    task("today", 0);
    await checkDueTasks();
    publishSpy.mockClear();

    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("stays due, not overdue, until the due day ends", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    publishSpy.mockClear();

    vi.setSystemTime(midnight(1) - 1);
    await checkDueTasks();
    expect(published()).toEqual([]);

    vi.setSystemTime(midnight(1));
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: t.id }]);
  });

  it("publishes due_cleared when a task is completed", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ completed: true }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("publishes due_cleared when a due date is pushed back out of range", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ dueDate: new Date(midnight(10)) }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("publishes due_cleared when a task is deleted outright", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    publishSpy.mockClear();

    db.run(sql`delete from tasks where id = ${t.id}`);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("only clears once, not on every subsequent check", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    db.run(sql`delete from tasks where id = ${t.id}`);
    await checkDueTasks();
    publishSpy.mockClear();

    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("re-publishes for a task that becomes due again after being cleared", async () => {
    const t = task("today", 0);
    await checkDueTasks();
    db.update(tasks).set({ completed: true }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ completed: false }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_soon", taskId: t.id }]);
  });

  it("tracks several tasks independently", async () => {
    const a = task("a", 0);
    const b = task("b", 5);
    await checkDueTasks();
    publishSpy.mockClear();

    // Only a crosses into overdue.
    vi.setSystemTime(midnight(1));
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: a.id }]);
    expect(published().some((p) => p.taskId === b.id)).toBe(false);
  });
});
