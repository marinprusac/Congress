import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeChamber, TEST_INTERNAL_TOKEN, type FakeChamber } from "@congress/test-support";
import type { AiRunResult } from "@congress/shared-types";
import type { DirectiveSummary } from "./types.js";

// Publishing is a network call (createPublishEvent -> Congress's event
// relay) - stubbed so these can assert on exactly what would be published.
const publishEvent = vi.fn();
vi.mock("./events.js", () => ({ publishEvent: (...args: unknown[]) => publishEvent(...args) }));

// Deputy's runs go to Congress's own AI over real HTTP - a fake Congress on
// an ephemeral port stands in for it. CAPITOL_URL is read at module load, so
// each test re-imports engine.js after pointing it at this test's fake.
let fakeCongress: FakeChamber | undefined;

async function loadEngine(origin: string) {
  process.env.CAPITOL_URL = origin;
  vi.resetModules();
  return import("./engine.js");
}

const directive: DirectiveSummary = {
  id: 7,
  title: "Water the plants",
  body: "Check the soil sensors.",
  enabled: true,
  scheduleType: null,
  intervalMs: null,
  scheduleHour: null,
  scheduleMinute: null,
  scheduleDayOfWeek: null,
  scheduleTimeZone: null,
  triggerEventType: null,
  nextRunAt: null,
  scheduleCycleStart: null,
  lastRunAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function runResult(overrides: Partial<AiRunResult> = {}): AiRunResult {
  return {
    ok: true,
    refused: false,
    response: "Watered.",
    errorMessage: null,
    transcript: [],
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 20,
    durationMs: 500,
    ...overrides,
  };
}

beforeEach(() => {
  publishEvent.mockClear();
  fakeCongress = undefined;
});

afterEach(async () => {
  await fakeCongress?.close();
});

describe("runDirective", () => {
  it("hands Congress the directive's prompt, tagged so Deputy's rings can find the run", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.post("/congress/ai/run", (c) => c.json(runResult()));
    });
    const { runDirective } = await loadEngine(fakeCongress.origin);

    await runDirective({ trigger: "manual", directive });

    const call = fakeCongress.received.find((r) => r.url === "/congress/ai/run")!;
    expect(call.headers["x-congress-internal-token"]).toBe(TEST_INTERNAL_TOKEN);
    const body = JSON.parse(call.body);
    expect(body.actor).toBe("deputy");
    expect(body.meta).toEqual({ chamber: "deputy", directiveId: 7 });
    expect(body.prompt).toContain("### Water the plants\nCheck the soil sensors.");
    expect(body.prompt).toContain("## Manual run");
  });

  it("publishes deputy.directive_run for every completed run, even one that took no action or failed", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.post("/congress/ai/run", (c) => c.json(runResult({ ok: false, errorMessage: "boom" })));
    });
    const { runDirective } = await loadEngine(fakeCongress.origin);

    await runDirective({ trigger: "scheduled", directive, events: [] });

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [event] = publishEvent.mock.calls[0]!;
    expect(event.type).toBe("deputy.directive_run");
    expect(event.payload).toMatchObject({ trigger: "scheduled", directiveId: 7, ok: false, actionTaken: false, errorMessage: "boom" });
  });

  it("marks actionTaken when the run called a tool", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.post("/congress/ai/run", (c) =>
        c.json(runResult({ transcript: [{ toolName: "notes.create_note", input: {}, output: null, error: null }] }))
      );
    });
    const { runDirective } = await loadEngine(fakeCongress.origin);

    await runDirective({ trigger: "manual", directive });

    expect(publishEvent.mock.calls[0]![0].payload.actionTaken).toBe(true);
  });

  it("reports nothing for a run Congress refused (paused/over budget) - it never ran", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.post("/congress/ai/run", (c) => c.json(runResult({ ok: false, refused: true, response: null, errorMessage: "AI is paused." })));
    });
    const { runDirective } = await loadEngine(fakeCongress.origin);

    const result = await runDirective({ trigger: "manual", directive });

    expect(result.refused).toBe(true);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("isAiPaused", () => {
  it("reads Congress's shared pause switch", async () => {
    fakeCongress = await startFakeChamber((app) => {
      app.get("/congress/ai/settings", (c) =>
        c.json({ contextPrompt: "", chatIdleWindowMs: 1, budgetCapUsd: 1, model: "m", retentionDays: 1, paused: true, pausedReason: null })
      );
    });
    const { isAiPaused } = await loadEngine(fakeCongress.origin);

    expect(await isAiPaused()).toBe(true);
  });

  it("treats an unreachable Congress as paused, so nothing gets drained or stamped", async () => {
    const { isAiPaused } = await loadEngine("http://127.0.0.1:9");
    expect(await isAiPaused()).toBe(true);
  });
});
