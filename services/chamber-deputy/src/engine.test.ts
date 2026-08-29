import { describe, expect, it, vi } from "vitest";

// Publishing is a network call (createPublishEvent -> Congress's event
// relay) - stub it so these stay off the network and can assert on exactly
// what would have been published.
const publishEvent = vi.fn();
vi.mock("./events.js", () => ({ publishEvent: (...args: unknown[]) => publishEvent(...args) }));

import { reportRun, type SpawnResult } from "./engine.js";
import type { DirectiveSummary } from "./types.js";

const directive: DirectiveSummary = {
  id: 7,
  title: "Water the plants",
  body: "",
  enabled: true,
  intervalMs: null,
  lastRunAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function spawnResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    ok: true,
    response: "Did the thing.",
    sessionId: "sess-1",
    errorMessage: null,
    transcript: [],
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 20,
    durationMs: 500,
    ...overrides,
  };
}

const toolCall = { toolName: "notes.create", input: {}, output: null, error: null };

describe("a directive-scoped run (manual/scheduled)", () => {
  it("publishes deputy.directive_run even when no action was taken", async () => {
    publishEvent.mockClear();
    await reportRun("scheduled", spawnResult({ transcript: [] }), directive);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [event] = publishEvent.mock.calls[0]!;
    expect(event.type).toBe("deputy.directive_run");
    expect(event.payload.directiveId).toBe(7);
    expect(event.payload.directiveTitle).toBe("Water the plants");
    expect(event.payload.actionTaken).toBe(false);
  });

  it("publishes even when the run failed", async () => {
    publishEvent.mockClear();
    await reportRun("manual", spawnResult({ ok: false, errorMessage: "boom" }), directive);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [event] = publishEvent.mock.calls[0]!;
    expect(event.payload.ok).toBe(false);
    expect(event.payload.errorMessage).toBe("boom");
  });

  it("marks actionTaken when the model did take action", async () => {
    publishEvent.mockClear();
    await reportRun("scheduled", spawnResult({ transcript: [toolCall] }), directive);

    const [event] = publishEvent.mock.calls[0]!;
    expect(event.payload.actionTaken).toBe(true);
  });
});

describe("a bundled chat run (no single directive)", () => {
  it("does not publish when it took no action", async () => {
    publishEvent.mockClear();
    await reportRun("chat", spawnResult({ transcript: [] }));

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("does not publish when the run failed, even with a transcript", async () => {
    publishEvent.mockClear();
    await reportRun("chat", spawnResult({ ok: false, transcript: [toolCall] }));

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("publishes deputy.directive_run with a null directive when it took real action", async () => {
    publishEvent.mockClear();
    await reportRun("chat", spawnResult({ transcript: [toolCall] }));

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [event] = publishEvent.mock.calls[0]!;
    expect(event.type).toBe("deputy.directive_run");
    expect(event.payload.directiveId).toBeNull();
    expect(event.payload.directiveTitle).toBeNull();
    expect(event.payload.actionTaken).toBe(true);
  });
});
