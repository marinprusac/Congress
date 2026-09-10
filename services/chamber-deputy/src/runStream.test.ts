import { beforeEach, describe, expect, it, vi } from "vitest";
import { startRun, emitProgress, finishRun, getSnapshot, onProgress, type RunProgressEvent } from "./runStream.js";

// runStream.ts holds module-level state (currentRun) - reset it between
// tests the only way it's exposed to change: starting a fresh run.
beforeEach(() => {
  startRun("chat", null);
});

describe("startRun/getSnapshot", () => {
  it("has no run before startRun is ever called", () => {
    // Nothing to assert against a truly pristine module (the beforeEach
    // above already started one) - covered instead by asserting a fresh
    // run's own snapshot starts with just its own run_started event.
    const snapshot = getSnapshot();
    expect(snapshot?.events).toEqual([{ type: "run_started", runId: snapshot!.runId, kind: "chat", directiveId: null, startedAt: snapshot!.startedAt }]);
  });

  it("tags a new run with a fresh runId, kind, and directiveId", () => {
    const runId = startRun("directive", 7);
    const snapshot = getSnapshot();
    expect(snapshot?.runId).toBe(runId);
    expect(snapshot?.kind).toBe("directive");
    expect(snapshot?.directiveId).toBe(7);
  });
});

describe("emitProgress/finishRun", () => {
  it("appends events for the current run to its own replayable snapshot, in order", () => {
    const runId = startRun("directive", 3);
    emitProgress({ type: "tool_start", runId, toolName: "notes.search_notes", input: {} });
    emitProgress({ type: "tool_result", runId, toolName: "notes.search_notes", output: [], error: null });
    finishRun({ type: "run_finished", runId, ok: true, response: "Done.", errorMessage: null });

    const snapshot = getSnapshot();
    expect(snapshot?.events.map((e) => e.type)).toEqual(["run_started", "tool_start", "tool_result", "run_finished"]);
  });

  it("ignores an event tagged with a stale runId from a since-superseded run", () => {
    const staleRunId = startRun("chat", null);
    const freshRunId = startRun("chat", null);
    emitProgress({ type: "assistant_text", runId: staleRunId, text: "late arrival" });

    const snapshot = getSnapshot();
    expect(snapshot?.runId).toBe(freshRunId);
    expect(snapshot?.events.some((e) => e.type === "assistant_text")).toBe(false);
  });

  it("leaves the finished run's own terminal state in place until the next run starts", () => {
    const runId = startRun("chat", null);
    finishRun({ type: "run_finished", runId, ok: true, response: "Done.", errorMessage: null });

    const snapshot = getSnapshot();
    expect(snapshot?.runId).toBe(runId);
    expect(snapshot?.events.at(-1)).toEqual({ type: "run_finished", runId, ok: true, response: "Done.", errorMessage: null });
  });
});

describe("onProgress", () => {
  it("delivers live events to a subscriber as they're emitted", () => {
    const received: RunProgressEvent[] = [];
    const unsubscribe = onProgress((event) => received.push(event));

    const runId = startRun("directive", 1);
    emitProgress({ type: "tool_start", runId, toolName: "tasks.create_task", input: {} });
    finishRun({ type: "run_finished", runId, ok: true, response: null, errorMessage: null });

    expect(received.map((e) => e.type)).toEqual(["run_started", "tool_start", "run_finished"]);
    unsubscribe();
  });

  it("stops delivering events once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = onProgress(listener);
    unsubscribe();

    startRun("chat", null);

    expect(listener).not.toHaveBeenCalled();
  });
});
