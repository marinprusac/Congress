import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

// Publishing is a network call (createPublishEvent -> Congress's event
// relay) - stub it so these stay off the network and can assert on exactly
// what would have been published.
const publishEvent = vi.fn();
vi.mock("./events.js", () => ({ publishEvent: (...args: unknown[]) => publishEvent(...args) }));

// A fake `claude` child process good enough to exercise spawnClaude's own
// stdout-parsing/exit-code logic without actually shelling out - it feeds
// the given stream-json lines through a real stdout PassThrough (spawnClaude
// reads it via node:readline, so it has to behave like a real stream) and
// then emits "close" with the given exit code, mirroring how the real CLI
// process ends.
let fakeChild: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
const spawnMock = vi.fn((..._args: unknown[]) => fakeChild);
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function queueFakeChild(opts: { lines: string[]; exitCode: number; stderr?: string }): void {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  fakeChild = child;
  queueMicrotask(() => {
    for (const line of opts.lines) child.stdout.write(`${line}\n`);
    child.stdout.end();
    if (opts.stderr) child.stderr.write(opts.stderr);
    child.stderr.end();
    child.emit("close", opts.exitCode);
  });
}

import { reportRun, spawnClaude, type SpawnResult } from "./engine.js";
import type { DirectiveSummary } from "./types.js";

const directive: DirectiveSummary = {
  id: 7,
  title: "Water the plants",
  body: "",
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

describe("spawnClaude", () => {
  const opts = { prompt: "do the thing", mcpConfigPath: "/tmp/mcp.json", model: "sonnet" };

  it("trusts a successful result event over a nonzero exit code", async () => {
    // Regression: a run that already streamed a successful "result" event
    // (is_error: false, with the real response) used to get overridden into
    // a reported failure if the CLI process happened to exit nonzero
    // afterwards (e.g. shutdown/cleanup noise) - the actions it already took
    // had genuinely succeeded, so the owner would see an error for a
    // directive that, a moment later, turned out to have worked.
    queueFakeChild({
      lines: [
        JSON.stringify({ session_id: "sess-1", type: "result", is_error: false, result: "Watered the plants.", total_cost_usd: 0.02 }),
      ],
      exitCode: 1,
      stderr: "some unrelated shutdown warning",
    });

    const result = await spawnClaude(opts);

    expect(result.ok).toBe(true);
    expect(result.response).toBe("Watered the plants.");
    expect(result.errorMessage).toBeNull();
  });

  it("still trusts a failed result event over a nonzero exit code", async () => {
    queueFakeChild({
      lines: [JSON.stringify({ session_id: "sess-1", type: "result", is_error: true, result: "Could not reach chamber-notes." })],
      exitCode: 1,
    });

    const result = await spawnClaude(opts);

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Could not reach chamber-notes.");
  });

  it("falls back to the exit code/stderr when no result event ever arrives", async () => {
    queueFakeChild({ lines: [], exitCode: 1, stderr: "claude: command failed to start" });

    const result = await spawnClaude(opts);

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("claude: command failed to start");
  });

  it("writes the prompt to the child's stdin rather than passing it as a CLI argument", async () => {
    // Regression: the prompt used to travel as a positional CLI argument
    // ("-p", opts.prompt, ...) - a scheduled/event run's own prompt embeds
    // every event received since that directive last ran (an unbounded
    // backlog), and a long enough one blew straight through the OS's argv
    // size limit, failing every subsequent run for that directive with
    // "spawn E2BIG" before the process ever started. Piped over stdin
    // instead, there's no such limit.
    queueFakeChild({
      lines: [JSON.stringify({ session_id: "sess-1", type: "result", is_error: false, result: "Done." })],
      exitCode: 0,
    });

    let written = "";
    fakeChild.stdin.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });

    await spawnClaude(opts);

    expect(written).toBe(opts.prompt);
    const [, args] = spawnMock.mock.calls[0]!;
    expect(args as string[]).not.toContain(opts.prompt);
  });

  it("reports ok on a clean exit with a successful result", async () => {
    queueFakeChild({
      lines: [JSON.stringify({ session_id: "sess-1", type: "result", is_error: false, result: "Done." })],
      exitCode: 0,
    });

    const result = await spawnClaude(opts);

    expect(result.ok).toBe(true);
    expect(result.response).toBe("Done.");
  });

  it("streams tool_start/tool_result/assistant_text onEvent callbacks in order as it parses", async () => {
    queueFakeChild({
      lines: [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "call-1", name: "notes.search_notes", input: { query: "plants" } }] },
        }),
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: [{ type: "text", text: "found 2 notes" }], is_error: false }] },
        }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Here's what I found." }] } }),
        JSON.stringify({ session_id: "sess-1", type: "result", is_error: false, result: "Here's what I found.", total_cost_usd: 0.01 }),
      ],
      exitCode: 0,
    });

    const events: unknown[] = [];
    await spawnClaude(opts, (event) => events.push(event));

    expect(events).toEqual([
      { type: "tool_start", toolName: "notes.search_notes", input: { query: "plants" } },
      { type: "tool_result", toolName: "notes.search_notes", output: [{ type: "text", text: "found 2 notes" }], error: null },
      { type: "assistant_text", text: "Here's what I found." },
    ]);
  });

  it("reports a tool error on the tool_result onEvent callback", async () => {
    queueFakeChild({
      lines: [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "call-1", name: "notes.create_note", input: {} }] } }),
        JSON.stringify({
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: "permission denied", is_error: true }] },
        }),
        JSON.stringify({ session_id: "sess-1", type: "result", is_error: true, result: "Could not create the note." }),
      ],
      exitCode: 0,
    });

    const events: unknown[] = [];
    await spawnClaude(opts, (event) => events.push(event));

    expect(events).toContainEqual({ type: "tool_result", toolName: "notes.create_note", output: "permission denied", error: "permission denied" });
  });
});
