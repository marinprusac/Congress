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

const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(() => runMigrations(migrationsDir("chamber-tasks")));

beforeEach(async () => {
  db.run(sql`delete from tasks`);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  // The "what did I last publish for this task" map is module-level and
  // deliberately in-memory (it resets on restart by design), so it outlives
  // an individual test. With no tasks left in the table, one check drains it
  // by publishing a clear for whatever the previous test left behind.
  publishSpy.mockResolvedValue(undefined);
  await checkDueTasks();
  publishSpy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  stopDueTaskNotifications();
  vi.useRealTimers();
});

function task(name: string, dueOffsetMs: number | null, completed = false) {
  return db
    .insert(tasks)
    .values({
      name,
      dueDate: dueOffsetMs === null ? null : new Date(NOW + dueOffsetMs),
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
    task("done", 2 * DAY, true);
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("arms for the due-soon threshold of a task more than a day out", () => {
    // Two thresholds per task: due - 24h, and due itself.
    task("later", 3 * DAY);
    expect(nextThresholdMs(NOW)).toBe(NOW + 2 * DAY);
  });

  it("arms for the due date itself once the due-soon threshold has passed", () => {
    task("soon", 6 * HOUR);
    expect(nextThresholdMs(NOW)).toBe(NOW + 6 * HOUR);
  });

  it("ignores a threshold that is already in the past", () => {
    // Anything already crossed is handled by the check that runs immediately
    // before the timer is re-armed.
    task("overdue", -2 * HOUR);
    expect(nextThresholdMs(NOW)).toBeNull();
  });

  it("takes the soonest threshold across every task", () => {
    task("far", 10 * DAY);
    task("near", 5 * HOUR);
    task("mid", 2 * DAY);
    expect(nextThresholdMs(NOW)).toBe(NOW + 5 * HOUR);
  });

  it("treats a threshold exactly at 'now' as passed, not upcoming", () => {
    task("boundary", DAY);
    expect(nextThresholdMs(NOW)).toBe(NOW + DAY);
  });
});

describe("checkDueTasks", () => {
  it("publishes nothing when no task is within the lookahead window", async () => {
    task("later", 3 * DAY);
    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("publishes due_soon for a task inside the 24-hour window", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_soon", taskId: t.id }]);
  });

  it("publishes overdue for a task past its due date", async () => {
    const t = task("late", -HOUR);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: t.id }]);
  });

  it("carries the name and a link in the payload, for a rule to template from", async () => {
    const t = task("Taxes", 6 * HOUR);
    await checkDueTasks();
    expect(publishSpy.mock.calls[0]![0].payload).toEqual({
      taskId: t.id,
      name: "Taxes",
      url: `/t/${t.id}`,
    });
  });

  it("ignores completed tasks entirely", async () => {
    task("done", -HOUR, true);
    await checkDueTasks();
    expect(published()).toEqual([]);
  });
});

describe("state transitions", () => {
  // A publish is a push-relayed switch, not a durable record - re-publishing
  // an unchanged state on every check would flood the Logs Chamber's
  // append-only history and re-fire automations with no dedupe of their own.
  it("does not re-publish a state that has not changed", async () => {
    task("soon", 6 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("publishes again when a task crosses from due_soon to overdue", async () => {
    const t = task("soon", 2 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    vi.setSystemTime(NOW + 3 * HOUR);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: t.id }]);
  });

  it("publishes due_cleared when a task is completed", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ completed: true }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("publishes due_cleared when a due date is pushed back out of range", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ dueDate: new Date(NOW + 10 * DAY) }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("publishes due_cleared when a task is deleted outright", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    db.run(sql`delete from tasks where id = ${t.id}`);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_cleared", taskId: t.id }]);
  });

  it("only clears once, not on every subsequent check", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    db.run(sql`delete from tasks where id = ${t.id}`);
    await checkDueTasks();
    publishSpy.mockClear();

    await checkDueTasks();
    expect(published()).toEqual([]);
  });

  it("re-publishes for a task that becomes due again after being cleared", async () => {
    const t = task("soon", 6 * HOUR);
    await checkDueTasks();
    db.update(tasks).set({ completed: true }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    publishSpy.mockClear();

    db.update(tasks).set({ completed: false }).where(sql`id = ${t.id}`).run();
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.due_soon", taskId: t.id }]);
  });

  it("tracks several tasks independently", async () => {
    const a = task("a", 2 * HOUR);
    const b = task("b", 6 * HOUR);
    await checkDueTasks();
    publishSpy.mockClear();

    // Only a crosses into overdue.
    vi.setSystemTime(NOW + 3 * HOUR);
    await checkDueTasks();
    expect(published()).toEqual([{ type: "tasks.overdue", taskId: a.id }]);
    expect(published().some((p) => p.taskId === b.id)).toBe(false);
  });
});

