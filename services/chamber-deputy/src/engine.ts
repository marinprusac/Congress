import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { env } from "./env.js";
import { getSettings, updateSettings } from "./settings.js";
import { recordSpend, todaySpendUsd } from "./spend.js";
import { writeMcpConfigFile } from "./mcpConfig.js";
import { buildPrompt, type PromptContext } from "./promptAssembly.js";
import { publishEvent } from "./events.js";
import { startRun, emitProgress, finishRun, type RunKind } from "./runStream.js";
import type { DeputyRunTrigger, DeputyTranscriptEntry, DirectiveSummary } from "./types.js";

// What spawnClaude reports as a run progresses, before it's known which
// runId this run will be assigned in runStream.ts - runDeputy tags each one
// with that runId on the way to emitProgress. Deliberately mirrors (a
// subset of) RunProgressEvent's own shape rather than importing it directly,
// since spawnClaude has no business knowing about runs/runIds at all - only
// about what it just parsed off the CLI's stdout.
export type SpawnProgressEvent =
  | { type: "tool_start"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: unknown; error: string | null }
  | { type: "assistant_text"; text: string };

export interface RunContext extends PromptContext {
  trigger: DeputyRunTrigger;
  // Chat only - the `claude` CLI's own session id to --resume, or null/
  // undefined to start a fresh session. See chat.ts's session-resolution
  // logic (docs/deputy-chamber-plan.md §8).
  resumeSessionId?: string | null;
}

export interface RunResult {
  ok: boolean;
  response: string | null;
  sessionId: string | null;
  errorMessage: string | null;
  costUsd: number | null;
}

export interface SpawnResult {
  ok: boolean;
  response: string | null;
  sessionId: string | null;
  errorMessage: string | null;
  transcript: DeputyTranscriptEntry[];
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}

function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : JSON.stringify(block)))
      .join("\n");
  }
  return JSON.stringify(content);
}

// Shells out to the `claude` CLI in headless/print mode (docs/
// deputy-chamber-plan.md §5) rather than the Agent SDK in-process, and
// stream-parses its --output-format stream-json events into a transcript as
// they arrive. Two non-negotiable details from the plan, both present
// below: --allowedTools restricted to "mcp__*" (excludes every built-in
// Bash/Read/Write/Edit/WebFetch tool - Chamber access stays MCP-mediated
// even fully unrestricted) and a dedicated Console ANTHROPIC_API_KEY rather
// than an interactive OAuth session. --strict-mcp-config additionally
// ensures the only MCP servers Deputy ever sees are the ones this run's own
// mcpConfig.ts generated from the live Chamber registry - never whatever
// else might be configured in this environment.
export async function spawnClaude(
  opts: { prompt: string; mcpConfigPath: string; model: string; resumeSessionId?: string | null },
  onEvent?: (event: SpawnProgressEvent) => void
): Promise<SpawnResult> {
  const args = [
    "-p",
    opts.prompt,
    "--mcp-config",
    opts.mcpConfigPath,
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    "--allowedTools",
    "mcp__*",
    "--dangerously-skip-permissions",
    "--model",
    opts.model,
  ];
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  // Only override these when Deputy's own env actually sets one (see
  // env.ts) - otherwise inherit process.env as-is, so the `claude` CLI
  // falls back to whatever ambient credential store `claude auth login`
  // already left for this OS user. Forcing an empty string here instead
  // would shadow a real inherited value and break auth entirely.
  const childEnv = { ...process.env };
  if (env.ANTHROPIC_API_KEY) childEnv.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;

  const startedAt = Date.now();
  const child = spawn("claude", args, {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const transcript: DeputyTranscriptEntry[] = [];
  const pendingToolUses = new Map<string, { name: string; input: unknown }>();
  let sessionId: string | null = null;
  let response: string | null = null;
  let costUsd: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let ok = false;
  let errorMessage: string | null = null;
  // Whether a terminal "result" event was ever parsed off stdout - once one
  // arrives it's the authoritative verdict for this run (it's what actually
  // carries is_error/response from the CLI itself), so a nonzero exit code
  // after that point must never override it. The CLI can still exit nonzero
  // on a run that already reported success (e.g. cleanup/shutdown noise
  // after streaming the result) - without this guard that flipped an
  // already-successful, already-actioned run into a reported failure.
  let gotResult = false;

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof evt.session_id === "string") sessionId = evt.session_id;

    if (evt.type === "assistant") {
      const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; id?: string; name?: string; input?: unknown; text?: string };
        if (b.type === "tool_use" && b.id && b.name) {
          pendingToolUses.set(b.id, { name: b.name, input: b.input });
          onEvent?.({ type: "tool_start", toolName: b.name, input: b.input });
        } else if (b.type === "text" && b.text) {
          onEvent?.({ type: "assistant_text", text: b.text });
        }
      }
    } else if (evt.type === "user") {
      const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === "tool_result" && b.tool_use_id) {
          const pending = pendingToolUses.get(b.tool_use_id);
          const error = b.is_error ? stringifyToolContent(b.content) : null;
          transcript.push({
            toolName: pending?.name ?? "unknown",
            input: pending?.input ?? null,
            output: b.content ?? null,
            error,
          });
          onEvent?.({ type: "tool_result", toolName: pending?.name ?? "unknown", output: b.content ?? null, error });
          pendingToolUses.delete(b.tool_use_id);
        }
      }
    } else if (evt.type === "result") {
      gotResult = true;
      ok = evt.is_error !== true;
      response = typeof evt.result === "string" ? evt.result : null;
      costUsd = typeof evt.total_cost_usd === "number" ? evt.total_cost_usd : null;
      const usage = evt.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : null;
      outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : null;
      if (!ok) errorMessage = response ?? "Deputy run failed.";
    }
  });

  let stderrOutput = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });

  // Only a fallback for a run that never got far enough to stream its own
  // verdict (crashed/killed before a "result" line) - once gotResult is
  // true, ok/errorMessage already reflect the CLI's own is_error, and a
  // nonzero exit after that point (cleanup/shutdown noise, an MCP client
  // still tearing down) must not override it.
  if (!gotResult && exitCode !== 0) {
    ok = false;
    errorMessage = stderrOutput.trim() || `claude exited with code ${exitCode}`;
  }

  return {
    ok,
    response,
    sessionId,
    errorMessage,
    transcript,
    costUsd,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startedAt,
  };
}

// One event type for every run, whichever of the four triggers produced it -
// deputy.report used to exist alongside this as a second, near-identical
// event for the bundled chat case, which just meant every Logs rule the
// owner wanted "when Deputy does something" had to be set up twice. Kept
// the deputy.directive_run name over deputy.report since it stays the more
// descriptive of the two even once it covers every trigger - a chat run is
// still fundamentally carrying out (some of) the same directives, just
// bundled rather than one at a time. `directive` is only ever present for
// manual/scheduled runs (chat still bundles every enabled directive into
// one prompt, so there's no single directive to attribute the report to).
// A directive-scoped run publishes on every completion, not gated on
// having taken action, since Deputy keeps no run history of its own any
// more and whether any of this is worth durably keeping or notifying on is
// entirely the receiving Logs Chamber rule's call (recordToHistory/
// notify); a chat run keeps the older "only worth mentioning if it
// actually did something" gate instead, since its own turn is already
// visible in the Chat page.
export async function reportRun(trigger: DeputyRunTrigger, spawnResult: SpawnResult, directive?: DirectiveSummary): Promise<void> {
  const actionTaken = spawnResult.transcript.length > 0;
  if (!directive && (!spawnResult.ok || !actionTaken)) return;

  await publishEvent({
    type: "deputy.directive_run",
    payload: {
      trigger,
      directiveId: directive?.id ?? null,
      directiveTitle: directive?.title ?? null,
      ok: spawnResult.ok,
      actionTaken,
      summary: spawnResult.response,
      errorMessage: spawnResult.errorMessage,
      toolCallCount: spawnResult.transcript.length,
      transcript: spawnResult.transcript,
      costUsd: spawnResult.costUsd,
      inputTokens: spawnResult.inputTokens,
      outputTokens: spawnResult.outputTokens,
      durationMs: spawnResult.durationMs,
    },
  });
}

// The whole "call every tool with --dangerously-skip-permissions" design
// leans on this being called for every headless invocation, no exceptions -
// the pause switch and budget cap (docs/deputy-chamber-plan.md §11) are
// enforced here, before a subprocess is ever spawned, not left to the
// caller to remember.
export async function runDeputy(ctx: RunContext): Promise<RunResult> {
  const settings = await getSettings();

  if (settings.paused) {
    return {
      ok: false,
      response: null,
      sessionId: null,
      errorMessage: `Deputy is paused${settings.pausedReason ? `: ${settings.pausedReason}` : "."}`,
      costUsd: null,
    };
  }

  const spentToday = await todaySpendUsd();
  if (spentToday >= settings.budgetCapUsd) {
    await updateSettings({ paused: true, pausedReason: `Daily budget cap reached ($${settings.budgetCapUsd.toFixed(2)}).` });
    return {
      ok: false,
      response: null,
      sessionId: null,
      errorMessage: "Daily budget cap reached; Deputy has been paused.",
      costUsd: null,
    };
  }

  const prompt = await buildPrompt(ctx);
  const mcpConfig = await writeMcpConfigFile();

  // Only ever a "chat" or a directive-tied run - a directive-triggered run
  // (manual/scheduled/event) always carries ctx.directive, and chat never
  // does (see RunContext/PromptContext). Started here, not at any of
  // runDeputy's own call sites, so every trigger is covered uniformly
  // without each one remembering to wrap its own call - see runStream.ts.
  const kind: RunKind = ctx.trigger === "chat" ? "chat" : "directive";
  const directiveId = ctx.directive?.id ?? null;
  const runId = startRun(kind, directiveId);

  try {
    const result = await spawnClaude(
      {
        prompt,
        mcpConfigPath: mcpConfig.path,
        model: settings.model,
        resumeSessionId: ctx.resumeSessionId,
      },
      (event) => emitProgress({ ...event, runId })
    );

    recordSpend(result.costUsd);

    await reportRun(ctx.trigger, result, ctx.directive);

    const spentAfter = await todaySpendUsd();
    if (spentAfter >= settings.budgetCapUsd) {
      await updateSettings({ paused: true, pausedReason: `Daily budget cap reached ($${settings.budgetCapUsd.toFixed(2)}).` });
    }

    finishRun({ type: "run_finished", runId, ok: result.ok, response: result.response, errorMessage: result.errorMessage });
    return { ok: result.ok, response: result.response, sessionId: result.sessionId, errorMessage: result.errorMessage, costUsd: result.costUsd };
  } catch (err) {
    finishRun({ type: "run_finished", runId, ok: false, response: null, errorMessage: (err as Error).message });
    throw err;
  } finally {
    await mcpConfig.cleanup();
  }
}
