import { eq, sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This Chamber's whole job is calling another Chamber's MCP tool, so the
// client half is mocked: what matters here is which tool gets called, with
// what arguments, and what is recorded about the outcome.
vi.mock("@congress/chamber-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@congress/chamber-kit")>()),
  fetchRegistry: vi.fn(),
  callChamberTool: vi.fn(),
}));
vi.mock("./events.js", () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));

import { callChamberTool, fetchRegistry } from "@congress/chamber-kit";
import { publishEvent } from "./events.js";
import { db, runMigrations } from "./db/client.js";
import { automationRuns, automations } from "./db/schema.js";
import { buildArgs, conditionMatches, handleReceivedEvent } from "./eventReceive.js";

beforeAll(() => runMigrations(migrationsDir("chamber-automation")));

beforeEach(() => {
  db.run(sql`delete from automation_runs`);
  db.run(sql`delete from automations`);
  // callChamberTool returns MCP's own CallToolResult envelope.
  vi.mocked(callChamberTool).mockReset().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  vi.mocked(publishEvent).mockClear();
  vi.mocked(fetchRegistry)
    .mockReset()
    .mockResolvedValue([
      {
        name: "notes",
        displayName: "Notes",
        version: "0.1.0",
        routes: { home: "/notes", settings: "/notes/settings" },
        widgets: [],
        events: [],
        subscriptions: [],
        apiBase: "http://127.0.0.1:9/api",
        mcpUrl: "http://127.0.0.1:9/mcp",
        healthUrl: "http://127.0.0.1:9/health",
        status: "active",
        registeredAt: new Date().toISOString(),
        lastHeartbeatAt: null,
      },
    ]);
});

function automation(overrides: Partial<typeof automations.$inferInsert> = {}) {
  return db
    .insert(automations)
    .values({
      title: "Log a note when a task falls due",
      triggerEventType: "tasks.due_soon",
      targetChamber: "notes",
      toolName: "create_note",
      argsTemplateJson: "{}",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
    .returning()
    .get();
}

function deliver(type: string, payload: Record<string, unknown> = {}) {
  return handleReceivedEvent({ chamber: "tasks", type, payload, occurredAt: new Date().toISOString() });
}

describe("conditionMatches", () => {
  const withCondition = (field: string | null, equals: string | null) => ({
    conditionField: field,
    conditionEquals: equals,
  });

  it("matches everything when no condition field is set", () => {
    expect(conditionMatches(withCondition(null, null), {})).toBe(true);
    expect(conditionMatches(withCondition(null, "anything"), { a: 1 })).toBe(true);
  });

  it("compares as strings, so a numeric payload matches its text form", () => {
    // The condition is a text column filled in by a form; the payload is
    // whatever JSON the publishing Chamber sent.
    expect(conditionMatches(withCondition("taskId", "42"), { taskId: 42 })).toBe(true);
    expect(conditionMatches(withCondition("done", "true"), { done: true })).toBe(true);
  });

  it("reads a nested field", () => {
    expect(conditionMatches(withCondition("task.status", "open"), { task: { status: "open" } })).toBe(true);
  });

  it("does not match a different value", () => {
    expect(conditionMatches(withCondition("taskId", "42"), { taskId: 43 })).toBe(false);
  });

  it("treats a missing field as the empty string", () => {
    expect(conditionMatches(withCondition("missing", ""), {})).toBe(true);
    expect(conditionMatches(withCondition("missing", "x"), {})).toBe(false);
  });

  it("treats a null value the same as a missing one", () => {
    expect(conditionMatches(withCondition("a", ""), { a: null })).toBe(true);
  });

  it("treats an unset conditionEquals as the empty string", () => {
    expect(conditionMatches(withCondition("a", null), { a: "" })).toBe(true);
    expect(conditionMatches(withCondition("a", null), { a: "x" })).toBe(false);
  });
});

describe("buildArgs", () => {
  // Each interpolated value is JSON.parsed when that succeeds, falling back
  // to the raw string. It is the most surprising rule in the codebase, so
  // the whole table is pinned here.
  it("passes ordinary text through as a string", () => {
    expect(buildArgs({ title: "Follow up on {{payload.name}}" }, { name: "Taxes" })).toEqual({
      title: "Follow up on Taxes",
    });
  });

  it("coerces a value that parses as JSON into its real type", () => {
    expect(buildArgs({ n: "{{payload.n}}", b: "{{payload.b}}" }, { n: 42, b: true })).toEqual({ n: 42, b: true });
  });

  it("coerces a literal template with no interpolation at all", () => {
    expect(buildArgs({ n: "3", b: "false", nil: "null" }, {})).toEqual({ n: 3, b: false, nil: null });
  });

  it("passes an object or array through as its real shape", () => {
    expect(buildArgs({ tags: "{{payload.tags}}" }, { tags: ["a", "b"] })).toEqual({ tags: "a,b" });
    expect(buildArgs({ tags: '["a","b"]' }, {})).toEqual({ tags: ["a", "b"] });
  });

  it("falls back to the raw string for anything JSON cannot parse", () => {
    expect(buildArgs({ title: "{a:1}" }, {})).toEqual({ title: "{a:1}" });
    expect(buildArgs({ title: "hello" }, {})).toEqual({ title: "hello" });
  });

  it("renders a missing field as an empty string, which is not valid JSON and so stays a string", () => {
    expect(buildArgs({ title: "{{payload.missing}}" }, {})).toEqual({ title: "" });
  });

  it("handles an empty template map", () => {
    expect(buildArgs({}, { a: 1 })).toEqual({});
  });
});

describe("handleReceivedEvent", () => {
  it("calls the target chamber's tool with interpolated arguments", async () => {
    automation({ argsTemplateJson: JSON.stringify({ title: "Due: {{payload.name}}", taskId: "{{payload.taskId}}" }) });
    await deliver("tasks.due_soon", { name: "Taxes", taskId: 7 });

    expect(callChamberTool).toHaveBeenCalledWith(expect.any(String), expect.any(String), "create_note", {
      title: "Due: Taxes",
      taskId: 7,
    });
  });

  it("ignores an event no automation is waiting for", async () => {
    automation({ triggerEventType: "tasks.due_soon" });
    await deliver("tasks.overdue");
    expect(callChamberTool).not.toHaveBeenCalled();
  });

  it("ignores a disabled automation", async () => {
    automation({ enabled: false });
    await deliver("tasks.due_soon");
    expect(callChamberTool).not.toHaveBeenCalled();
  });

  it("skips an automation whose condition does not hold", async () => {
    automation({ conditionField: "taskId", conditionEquals: "42" });
    await deliver("tasks.due_soon", { taskId: 7 });
    expect(callChamberTool).not.toHaveBeenCalled();
  });

  it("runs an automation whose condition holds", async () => {
    automation({ conditionField: "taskId", conditionEquals: "42" });
    await deliver("tasks.due_soon", { taskId: 42 });
    expect(callChamberTool).toHaveBeenCalledTimes(1);
  });

  it("runs every matching automation for one event", async () => {
    automation({ title: "A" });
    automation({ title: "B" });
    await deliver("tasks.due_soon");
    expect(callChamberTool).toHaveBeenCalledTimes(2);
  });

  it("keeps going when one automation throws, so a bad one cannot block the rest", async () => {
    automation({ title: "A" });
    automation({ title: "B" });
    vi.mocked(callChamberTool).mockRejectedValueOnce(new Error("boom"));

    await deliver("tasks.due_soon");
    expect(callChamberTool).toHaveBeenCalledTimes(2);
    expect(db.select().from(automationRuns).all()).toHaveLength(2);
  });

  it("stamps lastFiredAt on a run", async () => {
    const a = automation();
    await deliver("tasks.due_soon");
    expect(db.select().from(automations).where(eq(automations.id, a.id)).get()?.lastFiredAt).not.toBeNull();
  });
});

describe("run recording", () => {
  it("records a successful call with its result", async () => {
    vi.mocked(callChamberTool).mockResolvedValue({ content: [{ type: "text", text: '{"id":3}' }] });
    automation();
    await deliver("tasks.due_soon", { name: "Taxes" });

    const run = db.select().from(automationRuns).get()!;
    expect(run).toMatchObject({ ok: true, targetChamber: "notes", toolName: "create_note", errorMessage: null });
    expect(JSON.parse(run.resultJson!)).toEqual({ content: [{ type: "text", text: '{"id":3}' }] });
    expect(JSON.parse(run.payloadJson)).toEqual({ name: "Taxes" });
  });

  it("records a failed call with its error, and announces it at high priority", async () => {
    vi.mocked(callChamberTool).mockRejectedValue(new Error("tool exploded"));
    automation();
    await deliver("tasks.due_soon");

    expect(db.select().from(automationRuns).get()).toMatchObject({ ok: false, errorMessage: "tool exploded" });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "automation.run_failed",
        payload: expect.objectContaining({ error: "tool exploded", priority: "high" }),
      })
    );
  });

  it("records a run against an unreachable target rather than silently doing nothing", async () => {
    vi.mocked(fetchRegistry).mockResolvedValue([]);
    automation();
    await deliver("tasks.due_soon");

    expect(callChamberTool).not.toHaveBeenCalled();
    expect(db.select().from(automationRuns).get()).toMatchObject({ ok: false });
  });

  it("announces a success at low priority, leaving the decision to surface it to the Logs Chamber", async () => {
    automation();
    await deliver("tasks.due_soon");
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "automation.run_succeeded", payload: expect.objectContaining({ priority: "low" }) })
    );
  });

  // Only Date is faked, so the awaits below still resolve normally - the
  // point is just to give each run a distinct firedAt, since real deliveries
  // land milliseconds apart and same-millisecond ties are their own case
  // (below).
  async function deliverOverTime(count: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < count; i += 1) {
        vi.setSystemTime(new Date(Date.parse("2026-03-01T08:00:00.000Z") + i * 1000));
        await deliver("tasks.due_soon", { i });
      }
    } finally {
      vi.useRealTimers();
    }
  }

  it("prunes its own run log to the newest 20", async () => {
    const a = automation();
    await deliverOverTime(25);

    const runs = db.select().from(automationRuns).all();
    expect(runs).toHaveLength(20);
    // The oldest were dropped, not the newest.
    const kept = runs.map((r) => JSON.parse(r.payloadJson).i as number).sort((x, y) => x - y);
    expect(kept[0]).toBe(5);
    expect(kept.at(-1)).toBe(24);
    expect(runs.every((r) => r.automationId === a.id)).toBe(true);
  });

  it("prunes each automation's runs independently", async () => {
    const a = automation({ title: "A" });
    const b = automation({ title: "B" });
    await deliverOverTime(25);

    const runs = db.select().from(automationRuns).all();
    expect(runs.filter((r) => r.automationId === a.id)).toHaveLength(20);
    expect(runs.filter((r) => r.automationId === b.id)).toHaveLength(20);
  });

  it("keeps a few extra runs when several share a timestamp, since the prune deletes strictly older rows", async () => {
    // The cutoff is a firedAt value and the delete is `< cutoff`, so rows
    // sharing that exact millisecond all survive. Harmless - the log stays
    // bounded and converges as soon as timestamps advance - but worth
    // pinning so a change to the prune is visible rather than silent.
    automation({ title: "A" });
    automation({ title: "B" });
    for (let i = 0; i < 25; i += 1) await deliver("tasks.due_soon", { i });

    const runs = db.select().from(automationRuns).all();
    expect(runs.length).toBeGreaterThanOrEqual(40);
    expect(runs.length).toBeLessThan(50);
  });
});
