import { sql } from "drizzle-orm";
import { migrationsDir, waitFor } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// runDeputy shells out to the `claude` CLI - stubbed so these stay off the
// network/process spawn and can assert on exactly what it would have been
// called with.
vi.mock("./engine.js", () => ({ runDeputy: vi.fn().mockResolvedValue({ ok: true, response: "done", sessionId: null, errorMessage: null, costUsd: 0 }) }));

import { runDeputy } from "./engine.js";
import { db, runMigrations } from "./db/client.js";
import { directives, pendingCheckupEvents } from "./db/schema.js";
import { updateSettings } from "./settings.js";
import { handleReceivedEvent } from "./eventReceive.js";
import { drainPendingCheckupEvents } from "./pendingEvents.js";

beforeAll(() => runMigrations(migrationsDir("chamber-deputy")));

beforeEach(async () => {
  db.run(sql`delete from directives`);
  db.run(sql`delete from pending_checkup_events`);
  vi.mocked(runDeputy).mockClear();
  await updateSettings({ paused: false, pausedReason: null });
});

function eventDirective(overrides: Partial<typeof directives.$inferInsert> = {}) {
  const now = new Date();
  return db
    .insert(directives)
    .values({
      title: "Notify on overdue task",
      body: "",
      enabled: true,
      scheduleType: "event",
      triggerEventType: "tasks.overdue",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}

function deliver(type: string, payload: Record<string, unknown> = {}) {
  return handleReceivedEvent({ chamber: "tasks", type, payload, occurredAt: new Date().toISOString() });
}

describe("handleReceivedEvent", () => {
  it("fires an enabled event-triggered directive immediately when its trigger event arrives", async () => {
    const d = eventDirective();
    await deliver("tasks.overdue", { taskId: 42 });

    await waitFor(() => vi.mocked(runDeputy).mock.calls.length > 0, 2_000, "runDeputy to be called");
    expect(runDeputy).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "event",
        directive: expect.objectContaining({ id: d.id }),
        events: [expect.objectContaining({ chamber: "tasks", type: "tasks.overdue", payload: { taskId: 42 } })],
      })
    );
  });

  it("ignores a directive listening for a different event type", async () => {
    eventDirective({ triggerEventType: "tasks.overdue" });
    await deliver("tasks.due_soon");

    // Give the queue a beat to have run if it was (wrongly) going to.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runDeputy).not.toHaveBeenCalled();
  });

  it("ignores a disabled event-triggered directive", async () => {
    eventDirective({ enabled: false });
    await deliver("tasks.overdue");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runDeputy).not.toHaveBeenCalled();
  });

  it("ignores a directive scheduled some other way even if it shares a triggerEventType value", async () => {
    eventDirective({ scheduleType: "interval", intervalMs: 60_000 });
    await deliver("tasks.overdue");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runDeputy).not.toHaveBeenCalled();
  });

  it("fires every matching enabled directive for one event", async () => {
    eventDirective({ title: "A" });
    eventDirective({ title: "B" });
    await deliver("tasks.overdue");

    await waitFor(() => vi.mocked(runDeputy).mock.calls.length >= 2, 2_000, "both directives to run");
    expect(runDeputy).toHaveBeenCalledTimes(2);
  });

  it("stamps lastRunAt on the fired directive", async () => {
    const d = eventDirective();
    await deliver("tasks.overdue");

    await waitFor(() => {
      const row = db.select().from(directives).where(sql`${directives.id} = ${d.id}`).get();
      return row?.lastRunAt != null;
    }, 2_000, "lastRunAt to be stamped");
  });

  it("still buffers the event toward the next periodic checkup, regardless of any immediate fire", async () => {
    eventDirective();
    await deliver("tasks.overdue", { taskId: 7 });

    const buffered = drainPendingCheckupEvents();
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({ chamber: "tasks", type: "tasks.overdue", payload: { taskId: 7 } });
  });

  it("does nothing at all while Deputy is paused", async () => {
    eventDirective();
    await updateSettings({ paused: true, pausedReason: "testing" });
    await deliver("tasks.overdue");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runDeputy).not.toHaveBeenCalled();
    expect(db.select().from(pendingCheckupEvents).all()).toHaveLength(0);
  });
});
