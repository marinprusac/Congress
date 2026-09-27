import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunContext, RunOutcome } from "./engine.js";

const runAi = vi.fn<(ctx: RunContext) => Promise<RunOutcome>>();
vi.mock("./engine.js", () => ({ runAi: (ctx: RunContext) => runAi(ctx) }));
vi.mock("../feed.js", () => ({ getFeed: async () => [] }));

import { db, runMigrations } from "../db/client.js";
import { updateAiSettings } from "./settings.js";
import { createTracking } from "./memory.js";
import { bufferEvent, maybeGate, meterState, observeEvent, parseVerdict, resetProactive } from "./proactive.js";

function outcome(response: string | null, overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "r",
    ok: true,
    refused: false,
    cancelled: false,
    response,
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

const bufferCount = () => db.get<{ n: number }>(sql`select count(*) as n from ai_event_buffer`)?.n ?? 0;
const T0 = Date.parse("2026-09-27T12:00:00Z");
const ev = (type: string, actor = "system") => ({ chamber: type.split(".")[0] ?? "x", type, payload: { title: "Renew car" }, occurredAt: new Date(T0 + 1000).toISOString(), actor });

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
}

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(async () => {
  db.run(sql`delete from ai_event_buffer`);
  db.run(sql`delete from ai_tracking`);
  db.run(sql`delete from ai_settings`);
  await updateAiSettings({ quietHoursStart: null, quietHoursEnd: null, timeZone: "UTC", gateSensitivity: "normal", heartbeatHours: 48 });
  runAi.mockReset();
  resetProactive(T0);
});

describe("event buffer", () => {
  it("keeps other actors' events and skips the AI's own", () => {
    bufferEvent(ev("tasks.overdue"));
    bufferEvent(ev("notes.created", "congress"));
    bufferEvent(ev("congress.ai_chat_run"));
    expect(bufferCount()).toBe(1);
  });
});

describe("gate", () => {
  it("does nothing until the meter crosses its threshold", async () => {
    for (let i = 0; i < 3; i++) observeEvent(ev("notes.created"), T0 + i);
    await flush();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("asks the gate model with a digest, and stops there on a no", async () => {
    runAi.mockResolvedValue(outcome(JSON.stringify({ act: false, reason: "Routine edits." })));
    // Pressure decays continuously, so go clearly past the threshold of 6.
    for (let i = 0; i < 7; i++) observeEvent(ev("notes.created"), T0 + i);
    await flush();

    expect(runAi).toHaveBeenCalledTimes(1);
    const ctx = runAi.mock.calls[0]![0];
    expect(ctx).toMatchObject({ kind: "gate", model: "claude-haiku-4-5-20251001", trigger: "meter" });
    expect(ctx.jsonSchema).toBeTruthy();
    expect(ctx.body).toContain("notes.created");
    expect(meterState().pressure).toBe(0);
  });

  it("starts a proactive run with the gate's focus on a yes", async () => {
    runAi
      .mockResolvedValueOnce(outcome(JSON.stringify({ act: true, focus: "Car registration due soon", urgency: "push", reason: "Deadline in 3 days" })))
      .mockResolvedValueOnce(outcome("Sent a reminder."));
    createTracking({ title: "Car", watchEvents: [{ type: "tasks.overdue", immediate: false }] }, "UTC");
    // Watched events weigh triple: three clear the normal threshold.
    for (let i = 0; i < 3; i++) observeEvent(ev("tasks.overdue"), T0 + i);
    await flush();

    expect(runAi).toHaveBeenCalledTimes(2);
    const proactive = runAi.mock.calls[1]![0];
    expect(proactive).toMatchObject({ kind: "proactive", trigger: "gate" });
    expect(proactive.body).toContain("Car registration due soon");
    expect(proactive.body).toContain("Deadline in 3 days");
    expect(meterState().cooldownUntil).toBeGreaterThan(Date.now());
  });

  it("treats unusable gate output as a no", () => {
    expect(parseVerdict("not json").act).toBe(false);
    expect(parseVerdict(JSON.stringify({ act: "yes" })).act).toBe(false);
    expect(parseVerdict(JSON.stringify({ act: true, reason: "x" }))).toMatchObject({ act: true, urgency: "quiet" });
  });

  it("stays silent in quiet hours and when proactive AI is off", async () => {
    runAi.mockResolvedValue(outcome(JSON.stringify({ act: false, reason: "-" })));
    await updateAiSettings({ quietHoursStart: 0, quietHoursEnd: 0 });
    await updateAiSettings({ proactiveEnabled: false });
    for (let i = 0; i < 10; i++) observeEvent(ev("notes.created"), T0 + i);
    await flush();
    expect(runAi).not.toHaveBeenCalled();

    await updateAiSettings({ proactiveEnabled: true, quietHoursStart: 12, quietHoursEnd: 13 });
    expect(await maybeGate(T0 + 100)).toBeNull();
    expect(runAi).not.toHaveBeenCalled();
  });
});
