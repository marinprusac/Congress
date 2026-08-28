import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { PriorityLevel } from "@congress/shared-types";
import { env } from "./env.js";
import { getSettings, updateSettings } from "./settings.js";
import { recordSpend, todaySpendUsd } from "./spend.js";
import { writeMcpConfigFile } from "./mcpConfig.js";
import { buildPrompt, type PromptContext } from "./promptAssembly.js";
import { publishEvent } from "./events.js";
import type { DeputyRunTrigger, DeputyTranscriptEntry, DirectiveSummary } from "./types.js";

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
  priority: PriorityLevel;
}

// Trailing "PRIORITY: <level>" line convention - see promptAssembly.ts's
// base identity prompt for why the model is asked to emit this instead of
// Deputy having a bespoke reporting MCP tool (it exposes none, see
// mcp/tools.ts).
const PRIORITY_LINE_RE = /\n?PRIORITY:\s*(low|normal|high|urgent)\s*$/i;

function extractPriority(response: string | null): { text: string | null; priority: PriorityLevel } {
  if (!response) return { text: response, priority: "normal" };
  const match = response.match(PRIORITY_LINE_RE);
  if (!match) return { text: response, priority: "normal" };
  return { text: response.slice(0, match.index).trimEnd(), priority: match[1]!.toLowerCase() as PriorityLevel };
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
async function spawnClaude(opts: { prompt: string; mcpConfigPath: string; model: string; resumeSessionId?: string | null }): Promise<SpawnResult> {
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
        const b = block as { type?: string; id?: string; name?: string; input?: unknown };
        if (b.type === "tool_use" && b.id && b.name) pendingToolUses.set(b.id, { name: b.name, input: b.input });
      }
    } else if (evt.type === "user") {
      const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === "tool_result" && b.tool_use_id) {
          const pending = pendingToolUses.get(b.tool_use_id);
          transcript.push({
            toolName: pending?.name ?? "unknown",
            input: pending?.input ?? null,
            output: b.content ?? null,
            error: b.is_error ? stringifyToolContent(b.content) : null,
          });
          pendingToolUses.delete(b.tool_use_id);
        }
      }
    } else if (evt.type === "result") {
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

  if (exitCode !== 0 && !errorMessage) {
    ok = false;
    errorMessage = stderrOutput.trim() || `claude exited with code ${exitCode}`;
  }

  const { text, priority } = extractPriority(response);

  return {
    ok,
    response: text,
    sessionId,
    errorMessage,
    transcript,
    costUsd,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startedAt,
    priority,
  };
}

// One event type for every run, whichever of the four triggers produced it -
// deputy.report used to exist alongside this as a second, near-identical
// event for the bundled chat/urgent case, which just meant every Logs rule
// the owner wanted "when Deputy does something" had to be set up twice.
// Kept the deputy.directive_run name over deputy.report since it stays the
// more descriptive of the two even once it covers every trigger - a
// chat/urgent run is still fundamentally carrying out (some of) the same
// directives, just bundled rather than one at a time. `directive` is only
// ever present for manual/scheduled runs (chat/urgent still bundle every
// enabled directive into one prompt, so there's no single directive to
// attribute the report to). A directive-scoped run publishes on every
// completion, not gated on having taken action, since Deputy keeps no run
// history of its own any more and whether any of this is worth durably
// keeping or notifying on is entirely the receiving Logs Chamber rule's call
// (recordToHistory/minPriority/notify); a chat/urgent run keeps the older
// "only worth mentioning if it actually did something" gate instead, since
// its own turn is already visible in the Chat page.
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
      // The model only emits a PRIORITY line when it took action (see
      // extractPriority above) - a no-op tick is never worth more than low.
      priority: actionTaken ? spawnResult.priority : "low",
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

  try {
    const result = await spawnClaude({
      prompt,
      mcpConfigPath: mcpConfig.path,
      model: settings.model,
      resumeSessionId: ctx.resumeSessionId,
    });

    recordSpend(result.costUsd);

    await reportRun(ctx.trigger, result, ctx.directive);

    const spentAfter = await todaySpendUsd();
    if (spentAfter >= settings.budgetCapUsd) {
      await updateSettings({ paused: true, pausedReason: `Daily budget cap reached ($${settings.budgetCapUsd.toFixed(2)}).` });
    }

    return { ok: result.ok, response: result.response, sessionId: result.sessionId, errorMessage: result.errorMessage, costUsd: result.costUsd };
  } finally {
    await mcpConfig.cleanup();
  }
}
