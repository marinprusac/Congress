import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AiActivityEntry, AiRunKind, AiRunMeta, AiRunResult, AiRunStatus, AiTranscriptEntry } from "@congress/shared-types";
import { env } from "../env.js";
import { getAiSettings, updateAiSettings } from "./settings.js";
import { recordSpend, todaySpendUsd } from "./spend.js";
import { writeMcpConfigFile } from "./mcpConfig.js";
import { buildPrompt } from "./prompt.js";
import { memoryPromptSection } from "./memory.js";
import { startRun, emitProgress, finishRun } from "./runStream.js";
import { finishRunRow, insertRunRow } from "./runs.js";

// What spawnClaude reports as a run progresses; runAi tags each with a runId.
export type SpawnProgressEvent =
  | { type: "tool_start"; toolUseId: string; toolName: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; toolName: string; output: unknown; error: string | null }
  | { type: "assistant_text"; text: string }
  | { type: "assistant_delta"; text: string };

export interface SpawnResult {
  ok: boolean;
  cancelled: boolean;
  response: string | null;
  sessionId: string | null;
  errorMessage: string | null;
  transcript: AiTranscriptEntry[];
  activity: AiActivityEntry[];
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}

export interface SpawnOptions {
  prompt: string;
  // null runs with no MCP servers at all (the gate).
  mcpConfigPath: string | null;
  model: string;
  resumeSessionId?: string | null;
  signal?: AbortSignal;
  // Tool-less structured run: `--tools ""` plus `--json-schema`.
  jsonSchema?: object;
  timeoutMs?: number;
}

// A run stuck past this is killed so it can't block the queue forever.
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const KILL_GRACE_MS = 5_000;

function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : JSON.stringify(block)))
      .join("\n");
  }
  return JSON.stringify(content);
}

export function buildClaudeArgs(opts: SpawnOptions): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", opts.model];
  if (opts.jsonSchema) {
    args.push("--tools", "", "--json-schema", JSON.stringify(opts.jsonSchema));
  } else {
    args.push("--allowedTools", "mcp__*", "--dangerously-skip-permissions");
  }
  if (opts.mcpConfigPath) args.push("--mcp-config", opts.mcpConfigPath, "--strict-mcp-config");
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

// Shells out to the `claude` CLI in print mode and stream-parses its
// stream-json output. Only MCP tools are ever allowed; the prompt goes over
// stdin (argv has an OS size limit).
export async function spawnClaude(opts: SpawnOptions, onEvent?: (event: SpawnProgressEvent) => void): Promise<SpawnResult> {
  const args = buildClaudeArgs(opts);

  // Only override credentials Congress's own env sets; otherwise inherit.
  const childEnv = { ...process.env };
  if (env.ANTHROPIC_API_KEY) childEnv.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;

  const startedAt = Date.now();
  const child = spawn("claude", args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdin.write(opts.prompt);
  child.stdin.end();

  let cancelled = false;
  let timedOut = false;
  let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (closed) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
  };
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    stop();
  }, opts.timeoutMs ?? RUN_TIMEOUT_MS);

  const transcript: AiTranscriptEntry[] = [];
  const activity: AiActivityEntry[] = [];
  const pendingToolUses = new Map<string, { name: string; input: unknown; entry: Extract<AiActivityEntry, { type: "tool" }> }>();
  let lastText: string | null = null;
  let sessionId: string | null = null;
  let response: string | null = null;
  let costUsd: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let ok = false;
  let errorMessage: string | null = null;
  // A parsed "result" event is the authoritative verdict; a nonzero exit
  // afterwards (shutdown noise) must not flip it.
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

    if (evt.type === "stream_event") {
      const inner = evt.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
      if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
        onEvent?.({ type: "assistant_delta", text: inner.delta.text });
      }
    } else if (evt.type === "assistant") {
      const content = (evt.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; id?: string; name?: string; input?: unknown; text?: string };
        if (b.type === "tool_use" && b.id && b.name) {
          if (lastText?.trim()) activity.push({ type: "note", text: lastText });
          lastText = null;
          const entry: Extract<AiActivityEntry, { type: "tool" }> = {
            type: "tool",
            toolUseId: b.id,
            toolName: b.name,
            input: b.input ?? null,
            output: null,
            error: null,
          };
          activity.push(entry);
          pendingToolUses.set(b.id, { name: b.name, input: b.input, entry });
          onEvent?.({ type: "tool_start", toolUseId: b.id, toolName: b.name, input: b.input });
        } else if (b.type === "text" && b.text) {
          lastText = b.text;
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
          const toolName = pending?.name ?? "unknown";
          transcript.push({ toolName, input: pending?.input ?? null, output: b.content ?? null, error });
          if (pending) {
            pending.entry.output = b.content ?? null;
            pending.entry.error = error;
          }
          onEvent?.({ type: "tool_result", toolUseId: b.tool_use_id, toolName, output: b.content ?? null, error });
          pendingToolUses.delete(b.tool_use_id);
        }
      }
    } else if (evt.type === "result") {
      gotResult = true;
      ok = evt.is_error !== true;
      if (evt.structured_output !== undefined) response = JSON.stringify(evt.structured_output);
      else response = typeof evt.result === "string" ? evt.result : null;
      costUsd = typeof evt.total_cost_usd === "number" ? evt.total_cost_usd : null;
      const usage = evt.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : null;
      outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : null;
      if (!ok) errorMessage = (typeof evt.result === "string" ? evt.result : null) ?? "AI run failed.";
    }
  });

  let stderrOutput = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      closed = true;
      resolve(code ?? -1);
    });
  }).finally(() => {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    opts.signal?.removeEventListener("abort", onAbort);
  });

  if (cancelled) {
    ok = false;
    errorMessage = "Stopped.";
  } else if (timedOut) {
    ok = false;
    errorMessage = "The run took too long and was stopped.";
  } else if (!gotResult && exitCode !== 0) {
    ok = false;
    errorMessage = stderrOutput.trim() || `claude exited with code ${exitCode}`;
  }

  return {
    ok,
    cancelled,
    response: cancelled ? null : response,
    sessionId,
    errorMessage,
    transcript,
    activity,
    costUsd,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startedAt,
  };
}

export interface RunContext {
  kind: AiRunKind;
  // The caller's own part of the prompt; buildPrompt adds the frame.
  body: string;
  actor: string;
  meta?: AiRunMeta;
  // Minted by the caller when it needs the id before the run starts.
  runId?: string;
  threadId?: number | null;
  trigger?: string | null;
  resumeSessionId?: string | null;
  signal?: AbortSignal;
  model?: string;
  // Gate-style run: no MCP servers, no tools, structured output.
  jsonSchema?: object;
}

export type RunOutcome = AiRunResult & { runId: string; sessionId: string | null; activity: AiActivityEntry[] };

function outcomeStatus(result: { ok: boolean; cancelled: boolean }): AiRunStatus {
  if (result.cancelled) return "cancelled";
  return result.ok ? "ok" : "error";
}

async function pauseForBudget(capUsd: number): Promise<void> {
  await updateAiSettings({ paused: true, pausedReason: `Daily budget cap reached ($${capUsd.toFixed(2)}).` });
}

// Every headless invocation goes through here: the pause switch and the daily
// budget cap are enforced before a subprocess is ever spawned. Callers queue
// this via jobQueue.ts's enqueue.
export async function runAi(ctx: RunContext): Promise<RunOutcome> {
  const settings = await getAiSettings();
  const runId = ctx.runId ?? randomUUID();
  const threadId = ctx.threadId ?? null;
  const model = ctx.model ?? settings.model;
  const base = { kind: ctx.kind, trigger: ctx.trigger ?? null, actor: ctx.actor, model, threadId };

  const refuse = (errorMessage: string): RunOutcome => {
    insertRunRow({ id: runId, ...base, status: "refused", errorMessage });
    startRun(runId, ctx.kind, ctx.meta ?? {}, threadId);
    finishRun({ type: "run_finished", runId, threadId, status: "refused", ok: false, response: null, errorMessage });
    return {
      runId,
      ok: false,
      refused: true,
      cancelled: false,
      response: null,
      sessionId: null,
      errorMessage,
      transcript: [],
      activity: [],
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
    };
  };

  if (settings.paused) return refuse(`AI is paused${settings.pausedReason ? `: ${settings.pausedReason}` : "."}`);
  if (todaySpendUsd() >= settings.budgetCapUsd) {
    await pauseForBudget(settings.budgetCapUsd);
    return refuse("Daily budget cap reached; AI has been paused.");
  }

  const prompt = buildPrompt(settings, ctx.body, new Date(), ctx.jsonSchema ? undefined : memoryPromptSection(settings.timeZone));
  const mcpConfig = ctx.jsonSchema ? null : await writeMcpConfigFile(ctx.actor, { runId, threadId });
  insertRunRow({ id: runId, ...base, status: "running" });
  startRun(runId, ctx.kind, ctx.meta ?? {}, threadId);

  try {
    const result = await spawnClaude(
      {
        prompt,
        mcpConfigPath: mcpConfig?.path ?? null,
        model,
        resumeSessionId: ctx.resumeSessionId,
        signal: ctx.signal,
        jsonSchema: ctx.jsonSchema,
      },
      (event) => emitProgress({ ...event, runId })
    );

    recordSpend(ctx.actor, result.costUsd);
    if (todaySpendUsd() >= settings.budgetCapUsd) await pauseForBudget(settings.budgetCapUsd);

    const status = outcomeStatus(result);
    finishRunRow(runId, { ...result, status });
    finishRun({ type: "run_finished", runId, threadId, status, ok: result.ok, response: result.response, errorMessage: result.errorMessage });
    return { ...result, runId, refused: false };
  } catch (err) {
    const errorMessage = (err as Error).message;
    finishRunRow(runId, {
      status: "error",
      errorMessage,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
      activity: [],
    });
    finishRun({ type: "run_finished", runId, threadId, status: "error", ok: false, response: null, errorMessage });
    throw err;
  } finally {
    await mcpConfig?.cleanup();
  }
}
