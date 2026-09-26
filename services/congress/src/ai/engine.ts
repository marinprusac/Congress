import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AiRunKind, AiRunMeta, AiRunResult, AiTranscriptEntry } from "@congress/shared-types";
import { env } from "../env.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { recordSpend, todaySpendUsd } from "./spend.js";
import { writeMcpConfigFile } from "./mcpConfig.js";
import { buildPrompt } from "./prompt.js";
import { startRun, emitProgress, finishRun } from "./runStream.js";

// What spawnClaude reports as a run progresses, before it's known which
// runId the run was assigned - runAi tags each one on the way to
// emitProgress. spawnClaude itself knows nothing about runs, only about what
// it just parsed off the CLI's stdout.
export type SpawnProgressEvent =
  | { type: "tool_start"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; output: unknown; error: string | null }
  | { type: "assistant_text"; text: string };

export interface SpawnResult {
  ok: boolean;
  response: string | null;
  sessionId: string | null;
  errorMessage: string | null;
  transcript: AiTranscriptEntry[];
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

// Shells out to the `claude` CLI in headless/print mode and stream-parses its
// --output-format stream-json events as they arrive. --allowedTools is
// restricted to "mcp__*" (no built-in Bash/Read/Write/Edit/WebFetch - all
// access stays MCP-mediated), and --strict-mcp-config ensures the only MCP
// servers a run sees are the ones mcpConfig.ts generated from the live
// registry.
//
// The prompt travels over stdin, not argv - a caller's prompt (e.g. a Deputy
// directive with a long event backlog) has no fixed upper bound, and a long
// enough one blew through the OS's argv limit ("spawn E2BIG").
export async function spawnClaude(
  opts: { prompt: string; mcpConfigPath: string; model: string; resumeSessionId?: string | null },
  onEvent?: (event: SpawnProgressEvent) => void
): Promise<SpawnResult> {
  const args = [
    "-p",
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

  // Only override these when Congress's own env actually sets one - otherwise
  // inherit process.env as-is, so `claude` falls back to the ambient
  // credential store `claude auth login` left for this OS user.
  const childEnv = { ...process.env };
  if (env.ANTHROPIC_API_KEY) childEnv.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;

  const startedAt = Date.now();
  const child = spawn("claude", args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(opts.prompt);
  child.stdin.end();

  const transcript: AiTranscriptEntry[] = [];
  const pendingToolUses = new Map<string, { name: string; input: unknown }>();
  let sessionId: string | null = null;
  let response: string | null = null;
  let costUsd: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let ok = false;
  let errorMessage: string | null = null;
  // Once a terminal "result" event arrives it's the authoritative verdict
  // (it carries the CLI's own is_error) - a nonzero exit afterwards
  // (cleanup/shutdown noise) must not flip an already-successful run.
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
          transcript.push({ toolName: pending?.name ?? "unknown", input: pending?.input ?? null, output: b.content ?? null, error });
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
      if (!ok) errorMessage = response ?? "AI run failed.";
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

  // Only a fallback for a run that never streamed its own verdict.
  if (!gotResult && exitCode !== 0) {
    ok = false;
    errorMessage = stderrOutput.trim() || `claude exited with code ${exitCode}`;
  }

  return { ok, response, sessionId, errorMessage, transcript, costUsd, inputTokens, outputTokens, durationMs: Date.now() - startedAt };
}

export interface RunContext {
  kind: AiRunKind;
  // The caller's own part of the prompt; buildPrompt adds the frame.
  body: string;
  actor: string;
  meta?: AiRunMeta;
  // Chat only - the CLI session to --resume, or null to start fresh.
  resumeSessionId?: string | null;
}

export type RunOutcome = AiRunResult & { sessionId: string | null };

function refused(errorMessage: string): RunOutcome {
  return {
    ok: false,
    refused: true,
    response: null,
    sessionId: null,
    errorMessage,
    transcript: [],
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: 0,
  };
}

async function pauseForBudget(capUsd: number): Promise<void> {
  await updateAiSettings({ paused: true, pausedReason: `Daily budget cap reached ($${capUsd.toFixed(2)}).` });
}

// Every headless invocation goes through here, no exceptions - the pause
// switch and the shared daily budget cap are enforced before a subprocess is
// ever spawned, not left to each caller to remember. Callers queue this via
// jobQueue.ts's enqueue.
export async function runAi(ctx: RunContext): Promise<RunOutcome> {
  const settings = await getAiSettings();

  if (settings.paused) {
    return refused(`AI is paused${settings.pausedReason ? `: ${settings.pausedReason}` : "."}`);
  }
  if (todaySpendUsd() >= settings.budgetCapUsd) {
    await pauseForBudget(settings.budgetCapUsd);
    return refused("Daily budget cap reached; AI has been paused.");
  }

  const prompt = buildPrompt(settings, ctx.body);
  const mcpConfig = await writeMcpConfigFile(ctx.actor);
  const runId = startRun(ctx.kind, ctx.meta ?? {});

  try {
    const result = await spawnClaude(
      { prompt, mcpConfigPath: mcpConfig.path, model: settings.model, resumeSessionId: ctx.resumeSessionId },
      (event) => emitProgress({ ...event, runId })
    );

    recordSpend(ctx.actor, result.costUsd);
    if (todaySpendUsd() >= settings.budgetCapUsd) await pauseForBudget(settings.budgetCapUsd);

    finishRun({ type: "run_finished", runId, ok: result.ok, response: result.response, errorMessage: result.errorMessage });
    return { ...result, refused: false };
  } catch (err) {
    finishRun({ type: "run_finished", runId, ok: false, response: null, errorMessage: (err as Error).message });
    throw err;
  } finally {
    await mcpConfig.cleanup();
  }
}
