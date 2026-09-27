import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunContext, RunOutcome } from "./engine.js";

const runAi = vi.fn<(ctx: RunContext) => Promise<RunOutcome>>();
vi.mock("./engine.js", () => ({ runAi: (ctx: RunContext) => runAi(ctx) }));

import { db, runMigrations } from "../db/client.js";
import { updateAiSettings } from "./settings.js";
import { addFact, checkingItems, createTracking, getTracking, listTracking, memoryPromptSection } from "./memory.js";
import { REFUSED_RETRY_MS, handleEventForTracking, runTrackingTick, startTrackingCheck } from "./tracking.js";
import { sendMessage } from "./asks.js";

function outcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "r",
    ok: true,
    refused: false,
    cancelled: false,
    response: "Checked.",
    sessionId: null,
    errorMessage: null,
    transcript: [],
    activity: [],
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 1,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 200 && checkingItems.size > 0; i++) await new Promise((r) => setTimeout(r, 2));
}

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(async () => {
  db.run(sql`delete from ai_tracking`);
  db.run(sql`delete from ai_facts`);
  db.run(sql`delete from ai_messages`);
  db.run(sql`delete from ai_threads`);
  db.run(sql`delete from ai_settings`);
  await updateAiSettings({ timeZone: "UTC", quietHoursStart: null, quietHoursEnd: null });
  runAi.mockReset();
  runAi.mockResolvedValue(outcome());
});

const now = new Date("2026-09-27T10:00:00Z");

describe("scheduled checks", () => {
  it("starts a recurring item at its next slot", () => {
    const item = createTracking({ title: "Water plants", recurrence: { type: "daily", hour: 18, minute: 0 } }, "UTC", now);
    expect(item.nextCheckAt).toBe("2026-09-27T18:00:00.000Z");
  });

  it("runs a due check as a background tracking run and advances the recurrence", async () => {
    const item = createTracking({ title: "Water plants", body: "Remind if not done", recurrence: { type: "daily", hour: 9, minute: 0 }, nextCheckAt: new Date("2026-09-27T09:00:00Z") }, "UTC", now);

    await runTrackingTick(now);
    await settle();

    expect(runAi).toHaveBeenCalledTimes(1);
    const ctx = runAi.mock.calls[0]![0];
    expect(ctx).toMatchObject({ kind: "tracking", trigger: "schedule", meta: { trackingId: item.id } });
    expect(ctx.body).toContain('"Water plants"');
    expect(ctx.body).toContain("Remind if not done");
    expect(getTracking(item.id)).toMatchObject({ nextCheckAt: "2026-09-28T09:00:00.000Z", lastCheckedAt: now.toISOString() });
  });

  it("clears a one-off check once it has run, so it doesn't repeat", async () => {
    const item = createTracking({ title: "Once", nextCheckAt: new Date("2026-09-27T09:59:00Z") }, "UTC", now);
    await runTrackingTick(now);
    await settle();
    expect(getTracking(item.id)?.nextCheckAt).toBeNull();
  });

  it("comes back later when the AI refused (paused or over budget)", async () => {
    runAi.mockResolvedValue(outcome({ ok: false, refused: true, response: null }));
    const item = createTracking({ title: "Once", nextCheckAt: new Date("2026-09-27T09:59:00Z") }, "UTC", now);
    const before = Date.now();
    await runTrackingTick(now);
    await settle();
    const next = new Date(getTracking(item.id)!.nextCheckAt!).getTime();
    expect(next).toBeGreaterThanOrEqual(before + REFUSED_RETRY_MS - 1000);
  });

  it("skips paused and done items and never double-runs one item", async () => {
    createTracking({ title: "Paused", status: "paused", nextCheckAt: new Date("2026-09-27T09:00:00Z") }, "UTC", now);
    const active = createTracking({ title: "Active", nextCheckAt: new Date("2026-09-27T09:00:00Z") }, "UTC", now);
    let release!: () => void;
    runAi.mockImplementation(() => new Promise((r) => (release = () => r(outcome()))));

    await runTrackingTick(now);
    expect(await startTrackingCheck(active.id, "owner")).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    release();
    await settle();
    expect(runAi).toHaveBeenCalledTimes(1);
  });

  it("links the thread a check's first ask opened to the item", async () => {
    runAi.mockImplementation(async (ctx) => {
      await sendMessage({ body: "Don't forget", urgency: "quiet" }, { runId: ctx.runId ?? null, threadId: ctx.threadId ?? null });
      return outcome();
    });
    const item = createTracking({ title: "Renew car", nextCheckAt: new Date("2026-09-27T09:00:00Z") }, "UTC", now);
    await runTrackingTick(now);
    await settle();
    const linked = getTracking(item.id)?.threadId;
    expect(linked).toBeTruthy();

    // The next check's asks land in that same thread.
    runAi.mockClear();
    await startTrackingCheck(item.id, "owner");
    await settle();
    expect(runAi.mock.calls[0]?.[0].threadId).toBe(linked);
  });
});

describe("event triggers", () => {
  it("fires matching immediate watches, ignores the AI's own events, and cools down", () => {
    const a = createTracking({ title: "Overdue", watchEvents: [{ type: "tasks.overdue", immediate: true }] }, "UTC", now);
    const b = createTracking({ title: "Any task", watchEvents: [{ type: "tasks.*", immediate: true }] }, "UTC", now);
    createTracking({ title: "Passive", watchEvents: [{ type: "tasks.overdue", immediate: false }] }, "UTC", now);
    const items = listTracking(["active"]);
    const event = { chamber: "tasks", type: "tasks.overdue", payload: {}, occurredAt: now.toISOString() };

    expect(handleEventForTracking({ ...event, actor: "congress" }, items, 1_000_000)).toEqual([]);
    expect(handleEventForTracking(event, items, 1_000_000).sort()).toEqual([a.id, b.id].sort());
    expect(handleEventForTracking(event, items, 1_030_000)).toEqual([]);
    expect(handleEventForTracking(event, items, 1_070_000).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("memoryPromptSection", () => {
  it("lists facts and active items with their schedule", () => {
    addFact("Goes to the gym Mon/Wed/Fri evenings.", "ai");
    createTracking({ title: "Car registration", body: "Expires Oct 15.", recurrence: { type: "weekly", dayOfWeek: 1, hour: 9, minute: 0 } }, "UTC", now);
    const section = memoryPromptSection("UTC");
    expect(section).toContain("Goes to the gym Mon/Wed/Fri evenings.");
    expect(section).toContain('"Car registration"');
    expect(section).toContain("every Monday at 09:00");
    expect(section).toContain("Expires Oct 15.");
  });
});
