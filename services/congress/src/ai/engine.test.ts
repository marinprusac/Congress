import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { sql } from "drizzle-orm";
import { migrationsDir } from "@congress/test-support";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A fake `claude` child process good enough to exercise spawnClaude's own
// stdout-parsing/exit-code logic without actually shelling out - it feeds
// the given stream-json lines through a real stdout PassThrough (spawnClaude
// reads it via node:readline, so it has to behave like a real stream) and
// then emits "close" with the given exit code, mirroring how the real CLI
// process ends.
//
// Output is only fed once spawn() is actually called: runAi awaits settings
// and writes an MCP config file first, so emitting any earlier would fire
// "close" before spawnClaude ever attached its listener.
type FakeChild = EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: (signal?: string) => void };
let fakeChild: FakeChild;
let feedFakeChild: () => void = () => {};
const spawnMock = vi.fn((..._args: unknown[]) => {
  queueMicrotask(feedFakeChild);
  return fakeChild;
});
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// `hang: true` writes the lines but never exits until kill() is called.
function queueFakeChild(opts: { lines: string[]; exitCode: number; stderr?: string; hang?: boolean }): void {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    child.stdout.end();
    child.stderr.end();
    setTimeout(() => child.emit("close", null), 0);
  });
  fakeChild = child;
  feedFakeChild = () => {
    for (const line of opts.lines) child.stdout.write(`${line}\n`);
    if (opts.hang) return;
    child.stdout.end();
    if (opts.stderr) child.stderr.write(opts.stderr);
    child.stderr.end();
    child.emit("close", opts.exitCode);
  };
}

import { db, runMigrations } from "../db/client.js";
import { runAi, spawnClaude } from "./engine.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { recordSpend, todaySpendUsd } from "./spend.js";
import { replayEvents } from "./runStream.js";
import { getRunDetail } from "./runs.js";

beforeAll(() => runMigrations(migrationsDir("congress")));

beforeEach(() => {
  db.run(sql`delete from ai_spend`);
  db.run(sql`delete from ai_settings`);
  db.run(sql`delete from ai_runs`);
  spawnMock.mockClear();
});

const okResult = (costUsd = 0.01) =>
  JSON.stringify({ session_id: "sess-1", type: "result", is_error: false, result: "Done.", total_cost_usd: costUsd });

describe("runAi guardrails", () => {
  it("refuses without spawning when AI is paused", async () => {
    await updateAiSettings({ paused: true, pausedReason: "Paused by owner." });

    const result = await runAi({ kind: "remote", body: "do it", actor: "deputy" });

    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.errorMessage).toBe("AI is paused: Paused by owner.");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses and pauses without spawning once today's shared spend has reached the cap", async () => {
    await updateAiSettings({ budgetCapUsd: 1 });
    // Chat spend counts against the same cap as a Chamber's remote runs.
    recordSpend("congress", 1.5);

    const result = await runAi({ kind: "remote", body: "do it", actor: "deputy" });

    expect(result.refused).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
    expect((await getAiSettings()).paused).toBe(true);
  });

  it("records spend under the caller's actor and pauses once a run pushes spend over the cap", async () => {
    await updateAiSettings({ budgetCapUsd: 1 });
    queueFakeChild({ lines: [okResult(1.2)], exitCode: 0 });

    const result = await runAi({ kind: "remote", body: "do it", actor: "deputy" });

    expect(result.ok).toBe(true);
    expect(result.refused).toBe(false);
    expect(todaySpendUsd()).toBeCloseTo(1.2);
    const rows = db.all<{ actor: string }>(sql`select actor from ai_spend`);
    expect(rows).toEqual([{ actor: "deputy" }]);
    expect((await getAiSettings()).paused).toBe(true);
  });

  it("frames the caller's prompt with the owner's context and tags the run with the caller's meta", async () => {
    await updateAiSettings({ contextPrompt: "I live in Zagreb." });
    queueFakeChild({ lines: [okResult()], exitCode: 0 });
    let written = "";
    fakeChild.stdin.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });

    await runAi({ kind: "remote", body: "## This run's directive\nWater the plants", actor: "deputy", meta: { chamber: "deputy", directiveId: 7 } });

    expect(written).toContain("I live in Zagreb.");
    expect(written.endsWith("## This run's directive\nWater the plants")).toBe(true);
    const replay = replayEvents();
    expect(replay[0]).toMatchObject({ type: "run_started", kind: "remote", meta: { chamber: "deputy", directiveId: 7 } });
    expect(replay.at(-1)?.type).toBe("run_finished");
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
    // run that, a moment later, turned out to have worked.
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
    // ("-p", opts.prompt, ...) - a remote run's own prompt (e.g. a Deputy directive) can embed
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
      { type: "tool_start", toolUseId: "call-1", toolName: "notes.search_notes", input: { query: "plants" } },
      { type: "tool_result", toolUseId: "call-1", toolName: "notes.search_notes", output: [{ type: "text", text: "found 2 notes" }], error: null },
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

    expect(events).toContainEqual({
      type: "tool_result",
      toolUseId: "call-1",
      toolName: "notes.create_note",
      output: "permission denied",
      error: "permission denied",
    });
  });
});

describe("spawnClaude streaming and activity", () => {
  const opts = { prompt: "go", mcpConfigPath: "/tmp/mcp.json", model: "sonnet" };
  const delta = (text: string) =>
    JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });

  it("emits text deltas and records interim text before a tool as a note", async () => {
    queueFakeChild({
      lines: [
        delta("Let me "),
        delta("check."),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me check." }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__notes__search", input: {} }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Found it." }] } }),
        JSON.stringify({ type: "result", is_error: false, result: "Found it." }),
      ],
      exitCode: 0,
    });

    const events: { type: string }[] = [];
    const result = await spawnClaude(opts, (e) => events.push(e));

    expect(events.filter((e) => e.type === "assistant_delta")).toEqual([
      { type: "assistant_delta", text: "Let me " },
      { type: "assistant_delta", text: "check." },
    ]);
    expect(result.activity).toEqual([
      { type: "note", text: "Let me check." },
      { type: "tool", toolUseId: "t1", toolName: "mcp__notes__search", input: {}, output: "ok", error: null },
    ]);
    expect(result.response).toBe("Found it.");
  });

  it("pairs parallel calls to the same tool by id, not name", async () => {
    queueFakeChild({
      lines: [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "a", name: "search", input: { q: 1 } },
              { type: "tool_use", id: "b", name: "search", input: { q: 2 } },
            ],
          },
        }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", content: "two" }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "one" }] } }),
        JSON.stringify({ type: "result", is_error: false, result: "done" }),
      ],
      exitCode: 0,
    });

    const result = await spawnClaude(opts);

    expect(result.activity).toMatchObject([
      { toolUseId: "a", input: { q: 1 }, output: "one" },
      { toolUseId: "b", input: { q: 2 }, output: "two" },
    ]);
  });

  it("kills the child and reports cancelled when the signal aborts", async () => {
    queueFakeChild({ lines: [delta("Working")], exitCode: 0, hang: true });
    const controller = new AbortController();

    const pending = spawnClaude({ ...opts, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const result = await pending;

    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.response).toBeNull();
  });

  it("kills a run that exceeds its timeout", async () => {
    queueFakeChild({ lines: [], exitCode: 0, hang: true });

    const result = await spawnClaude({ ...opts, timeoutMs: 10 });

    expect(fakeChild.kill).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.errorMessage).toMatch(/too long/);
  });

  it("isolates every run from the machine's own MCP servers, skills and project files", async () => {
    queueFakeChild({ lines: [JSON.stringify({ type: "result", is_error: false, result: "ok" })], exitCode: 0 });

    await spawnClaude(opts);

    const [, args, options] = spawnMock.mock.calls[0]! as [string, string[], { cwd: string }];
    expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--mcp-config", "/tmp/mcp.json", "--disable-slash-commands", "--system-prompt"]));
    expect(options.cwd).not.toContain("Congress");
    expect(options.cwd).toMatch(/congress-ai-workspace$/);
  });

  it("runs a structured gate call with no tools and returns its structured output", async () => {
    queueFakeChild({
      lines: [JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { act: false } })],
      exitCode: 0,
    });

    const result = await spawnClaude({ prompt: "p", mcpConfigPath: "/tmp/empty.json", model: "haiku", jsonSchema: { type: "object" } });

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--tools", "", "--json-schema", '{"type":"object"}']));
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(JSON.parse(result.response ?? "null")).toEqual({ act: false });
  });
});

describe("runAi run records", () => {
  it("writes an ai_runs row with the run's activity and cost", async () => {
    queueFakeChild({
      lines: [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "r" }] } }),
        okResult(0.05),
      ],
      exitCode: 0,
    });

    const result = await runAi({ kind: "chat", body: "hi", actor: "congress", runId: "run-1", threadId: 3 });

    expect(result.runId).toBe("run-1");
    const run = getRunDetail("run-1");
    expect(run).toMatchObject({ status: "ok", kind: "chat", threadId: 3, toolCallCount: 1, costUsd: 0.05 });
    expect(run?.activity).toHaveLength(1);
  });

  it("records a refused run and still streams run_finished", async () => {
    await updateAiSettings({ paused: true });

    await runAi({ kind: "chat", body: "hi", actor: "congress", runId: "run-2", threadId: 4 });

    expect(getRunDetail("run-2")?.status).toBe("refused");
    expect(replayEvents().at(-1)).toMatchObject({ type: "run_finished", status: "refused", threadId: 4 });
  });

  it("refuses runs Congress starts itself once their own budget is spent, but not chat", async () => {
    await updateAiSettings({ proactiveBudgetUsd: 0.5 });
    db.run(sql`insert into ai_runs (id, kind, actor, status, started_at, cost_usd, tool_call_count) values ('old', 'tracking', 'congress', 'ok', ${Date.now()}, 0.6, 0)`);

    const tracking = await runAi({ kind: "tracking", body: "check", actor: "congress" });
    expect(tracking).toMatchObject({ refused: true, errorMessage: "Today's budget for proactive AI is used up." });
    expect(spawnMock).not.toHaveBeenCalled();

    queueFakeChild({ lines: [okResult()], exitCode: 0 });
    expect((await runAi({ kind: "chat", body: "hi", actor: "congress" })).refused).toBe(false);
  });

  it("refuses proactive runs when proactive AI is turned off", async () => {
    await updateAiSettings({ proactiveEnabled: false });
    expect((await runAi({ kind: "proactive", body: "x", actor: "congress" })).errorMessage).toBe("Proactive AI is turned off.");
  });

  it("uses a per-run model override", async () => {
    queueFakeChild({ lines: [okResult()], exitCode: 0 });

    await runAi({ kind: "gate", body: "g", actor: "congress", model: "claude-haiku-4-5-20251001", jsonSchema: { type: "object" } });

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-haiku-4-5-20251001"]));
  });
});
