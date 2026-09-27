import { describe, expect, it } from "vitest";
import type { AiStreamEvent } from "@congress/shared-types";
import { emitProgress, finishRun, onStreamEvent, replayEvents, startRun } from "./runStream.js";

describe("runStream", () => {
  it("replays a run's events without deltas, plus the current live text", () => {
    startRun("r1", "chat", { threadId: 1 }, 1);
    emitProgress({ type: "assistant_delta", runId: "r1", text: "Hel" });
    emitProgress({ type: "assistant_delta", runId: "r1", text: "lo" });

    const replay = replayEvents();

    expect(replay.map((e) => e.type)).toEqual(["run_started", "assistant_text"]);
    expect(replay.at(-1)).toEqual({ type: "assistant_text", runId: "r1", text: "Hello" });
  });

  it("commits text written before a tool call as a note", () => {
    startRun("r2", "chat", {}, 2);
    const seen: AiStreamEvent[] = [];
    const off = onStreamEvent((e) => seen.push(e));
    emitProgress({ type: "assistant_text", runId: "r2", text: "Checking." });
    emitProgress({ type: "tool_start", runId: "r2", toolUseId: "t", toolName: "x", input: {} });
    off();

    expect(seen.map((e) => e.type)).toEqual(["assistant_text", "assistant_note", "tool_start"]);
    expect(replayEvents().map((e) => e.type)).toEqual(["run_started", "assistant_note", "tool_start"]);
  });

  it("stops appending live text once the run finishes", () => {
    startRun("r3", "chat", {}, null);
    emitProgress({ type: "assistant_delta", runId: "r3", text: "Done" });
    finishRun({ type: "run_finished", runId: "r3", threadId: null, status: "ok", ok: true, response: "Done", errorMessage: null });

    expect(replayEvents().at(-1)?.type).toBe("run_finished");
  });

  it("ignores progress from a run that is no longer current", () => {
    startRun("old", "chat", {}, null);
    startRun("new", "chat", {}, null);
    emitProgress({ type: "tool_start", runId: "old", toolUseId: "t", toolName: "x", input: {} });

    expect(replayEvents().map((e) => e.runId)).toEqual(["new"]);
  });
});
