import { describe, expect, it } from "vitest";
import { INITIAL_AI_STREAM_STATE, reduceAiStream, type AiStreamMessage, type AiStreamState } from "./aiStream.js";

function play(events: AiStreamMessage[], from: AiStreamState = INITIAL_AI_STREAM_STATE): AiStreamState {
  return events.reduce(reduceAiStream, from);
}

const started: AiStreamMessage = { type: "run_started", runId: "r", kind: "chat", meta: { threadId: 7 }, threadId: 7, startedAt: 1 };

describe("reduceAiStream", () => {
  it("accumulates deltas and lets assistant_text replace them", () => {
    const s = play([
      started,
      { type: "assistant_delta", runId: "r", text: "Hel" },
      { type: "assistant_delta", runId: "r", text: "lo" },
    ]);
    expect(s.run?.text).toBe("Hello");
    expect(play([{ type: "assistant_text", runId: "r", text: "Hello!" }], s).run?.text).toBe("Hello!");
  });

  it("moves text before a tool into a note exactly once", () => {
    const s = play([
      started,
      { type: "assistant_delta", runId: "r", text: "Checking" },
      { type: "assistant_note", runId: "r", text: "Checking" },
      { type: "tool_start", runId: "r", toolUseId: "t1", toolName: "mcp__notes__search", input: { q: "x" } },
    ]);
    expect(s.run?.activity).toEqual([
      { type: "note", text: "Checking" },
      { type: "tool", toolUseId: "t1", toolName: "mcp__notes__search", input: { q: "x" }, done: false },
    ]);
    expect(s.run?.text).toBe("");
  });

  it("pairs results by tool use id", () => {
    const s = play([
      started,
      { type: "tool_start", runId: "r", toolUseId: "a", toolName: "search", input: 1 },
      { type: "tool_start", runId: "r", toolUseId: "b", toolName: "search", input: 2 },
      { type: "tool_result", runId: "r", toolUseId: "a", toolName: "search", output: "A", error: null },
    ]);
    expect(s.run?.activity).toMatchObject([
      { toolUseId: "a", input: 1, output: "A", done: true },
      { toolUseId: "b", input: 2, done: false },
    ]);
  });

  it("ignores events for a run that isn't current and resets on a new run", () => {
    const s = play([started, { type: "assistant_delta", runId: "other", text: "nope" }]);
    expect(s.run?.text).toBe("");
    const next = play([{ type: "run_started", runId: "r2", kind: "gate", meta: {}, threadId: null, startedAt: 2 }], s);
    expect(next.run).toMatchObject({ runId: "r2", activity: [], finished: false });
  });

  it("marks the run finished with its status and tracks queue and connection", () => {
    const s = play([
      started,
      { type: "run_finished", runId: "r", threadId: 7, status: "cancelled", ok: false, response: null, errorMessage: "Stopped." },
      { type: "queue", running: null, waiting: [{ runId: "q", kind: "chat", threadId: 2, meta: {} }] },
      { type: "connection", connected: true },
    ]);
    expect(s.run).toMatchObject({ finished: true, status: "cancelled" });
    expect(s.queue.waiting).toHaveLength(1);
    expect(s.connected).toBe(true);
    expect(play([{ type: "idle" }], s).run).toBeNull();
  });
});
