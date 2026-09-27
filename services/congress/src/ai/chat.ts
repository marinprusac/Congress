import { randomUUID } from "node:crypto";
import type { AiMessage, AiRunKind, AiThread, CreateAiThreadRequest } from "@congress/shared-types";
import { enqueue, JobCancelledError, PRIORITY } from "./jobQueue.js";
import { runAi, type RunOutcome } from "./engine.js";
import { chatPromptBody, type ReferencedExhibit } from "./prompt.js";
import { notifyThreadUpdated } from "./runStream.js";
import { markInterruptedRuns } from "./runs.js";
import {
  deleteMessageRow,
  getThread,
  getThreadRow,
  insertMessage,
  insertThread,
  listPendingThreadRows,
  listThreadMessages,
  titleFromText,
  updateThreadRow,
} from "./threads.js";
import { publishEvent } from "../events.js";
import { resolveExhibits } from "../exhibits.js";
import { extractExhibitTokensWithLabels } from "@congress/chamber-kit";

export class ThreadNotFoundError extends Error {}
export class ThreadBusyError extends Error {}

// Resolves the exhibit tokens in an owner message so the AI knows what they
// point at without a lookup of its own.
export async function resolveReferencedExhibits(text: string): Promise<ReferencedExhibit[]> {
  const tokens = extractExhibitTokensWithLabels(text).slice(0, 20);
  if (tokens.length === 0) return [];
  const results = await resolveExhibits(tokens.map((t) => ({ id: t.id, chamber: t.chamber }))).catch(() => null);
  return tokens.map((t, i) => {
    const r = results?.[i];
    if (r && "name" in r) return { token: t.token, label: t.label, name: r.name, url: r.url, state: "ok" as const };
    return { token: t.token, label: t.label, name: null, url: null, state: r && "deleted" in r ? ("deleted" as const) : ("unavailable" as const) };
  });
}

export async function ownerMessageBody(text: string): Promise<string> {
  return chatPromptBody(text, await resolveReferencedExhibits(text));
}

// A stored session the CLI no longer has; the run is retried fresh.
const MISSING_SESSION = /no conversation found|session .*not found/i;

export function createThread(input: CreateAiThreadRequest): { thread: AiThread; runId: string | null } {
  const row = insertThread({ title: input.title ?? (input.text ? titleFromText(input.text) : null) });
  if (!input.text) return { thread: getThread(row.id) as AiThread, runId: null };
  const { runId } = postMessage(row.id, input.text);
  return { thread: getThread(row.id) as AiThread, runId };
}

// Stores the owner's message and queues the reply; returns without waiting.
export function postMessage(threadId: number, text: string): { userMessage: AiMessage; runId: string } {
  const thread = getThreadRow(threadId);
  if (!thread) throw new ThreadNotFoundError();
  if (thread.pendingRunId) throw new ThreadBusyError();
  if (!thread.title) updateThreadRow(threadId, { title: titleFromText(text) });
  if (thread.archivedAt) updateThreadRow(threadId, { archivedAt: null });
  const userMessage = insertMessage({ threadId, role: "user", text });
  const runId = startThreadRun(threadId, { kind: "chat", buildBody: () => ownerMessageBody(text), summaryText: text });
  return { userMessage, runId };
}

// Re-runs the last owner message whose reply failed, was refused or stopped.
export function retryLast(threadId: number): { runId: string } {
  const thread = getThreadRow(threadId);
  if (!thread) throw new ThreadNotFoundError();
  if (thread.pendingRunId) throw new ThreadBusyError();
  const page = listThreadMessages(threadId, { limit: 2 });
  const [prev, last] = page.messages.length === 2 ? page.messages : [undefined, page.messages[0]];
  let userText: string | null = null;
  if (last?.role === "user") userText = last.text;
  else if (last && last.role === "assistant" && last.status !== "ok" && prev?.role === "user") {
    deleteMessageRow(last.id);
    userText = prev.text;
  }
  if (!userText) throw new ThreadBusyError("Nothing to retry.");
  const text = userText;
  const runId = startThreadRun(threadId, { kind: "chat", buildBody: () => ownerMessageBody(text), summaryText: text });
  notifyThreadUpdated(threadId);
  return { runId };
}

export interface ThreadRunInput {
  kind: AiRunKind;
  // Built when the run starts (it may resolve exhibits over the network).
  buildBody: () => Promise<string>;
  // What the owner said, for the congress.ai_chat_run event.
  summaryText: string;
  trigger?: string;
}

// Queues one run in a thread. The reply row is written when it settles, and
// pendingRunId tracks it so every client can see it's in flight.
export function startThreadRun(threadId: number, input: ThreadRunInput): string {
  const runId = randomUUID();
  updateThreadRow(threadId, { pendingRunId: runId });
  notifyThreadUpdated(threadId);

  // The fresh-session fallback swaps in a new run id; cleanup follows it.
  const current = { runId };
  void enqueue((signal) => executeThreadRun(threadId, current, input, signal), {
    entry: { runId, kind: input.kind, threadId, meta: { threadId } },
    priority: PRIORITY.interactive,
  })
    .catch((err: unknown) => {
      const cancelled = err instanceof JobCancelledError;
      insertMessage({
        threadId,
        role: "assistant",
        status: cancelled ? "cancelled" : "error",
        text: cancelled ? "Stopped." : `Something went wrong: ${(err as Error).message}`,
        runId: cancelled ? null : runId,
      });
    })
    .finally(() => {
      const row = getThreadRow(threadId);
      if (row?.pendingRunId === current.runId) updateThreadRow(threadId, { pendingRunId: null });
      notifyThreadUpdated(threadId);
    });
  return runId;
}

async function executeThreadRun(threadId: number, current: { runId: string }, input: ThreadRunInput, signal: AbortSignal): Promise<void> {
  const thread = getThreadRow(threadId);
  if (!thread) return;
  const body = await input.buildBody();
  const common = { kind: input.kind, body, actor: "congress", threadId, trigger: input.trigger ?? "owner", signal, meta: { threadId } };

  let result: RunOutcome = await runAi({ ...common, runId: current.runId, resumeSessionId: thread.sessionId });
  if (!result.ok && !result.refused && !result.cancelled && thread.sessionId && result.activity.length === 0 && MISSING_SESSION.test(result.errorMessage ?? "")) {
    current.runId = randomUUID();
    updateThreadRow(threadId, { pendingRunId: current.runId, sessionId: null });
    notifyThreadUpdated(threadId);
    result = await runAi({ ...common, runId: current.runId, resumeSessionId: null });
  }

  // A thread deleted mid-run has nowhere to put the reply.
  if (!getThreadRow(threadId)) return;
  if (result.sessionId) updateThreadRow(threadId, { sessionId: result.sessionId });

  const status = result.refused ? "refused" : result.cancelled ? "cancelled" : result.ok ? "ok" : "error";
  const text =
    status === "ok"
      ? (result.response?.trim() || "(no response)")
      : status === "cancelled"
        ? "Stopped."
        : (result.errorMessage ?? "The assistant failed to respond.");
  insertMessage({ threadId, role: "assistant", status, text, runId: result.runId });

  if (result.ok && result.transcript.length > 0) {
    publishEvent({
      chamber: "congress",
      type: "congress.ai_chat_run",
      actor: "congress",
      payload: {
        message: input.summaryText,
        summary: result.response,
        toolCallCount: result.transcript.length,
        transcript: result.transcript,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      },
    });
  }
}

// Boot: the queue is in memory, so anything pending was lost with the process.
export function recoverInterruptedThreads(): void {
  markInterruptedRuns();
  for (const row of listPendingThreadRows()) {
    insertMessage({ threadId: row.id, role: "assistant", status: "error", text: "Interrupted by a restart. Retry to send it again.", runId: row.pendingRunId });
    updateThreadRow(row.id, { pendingRunId: null });
  }
}

