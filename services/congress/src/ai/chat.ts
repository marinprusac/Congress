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
import { getCachedChamber, resolveExhibits } from "../exhibits.js";
import { extractExhibitTokensWithLabels, WIKILINK_PATTERN } from "../kit/wikilinks.js";
import { buildExhibitToken, parseExhibitToken } from "@congress/shared-types";

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

// A token the AI made up (never known to Congress, and its Chamber says it
// doesn't exist) becomes its plain label rather than a "deleted" chip.
export async function repairInventedTokens(text: string): Promise<string> {
  const tokens = extractExhibitTokensWithLabels(text).slice(0, 40);
  if (tokens.length === 0) return text;
  const results = await resolveExhibits(tokens.map((t) => ({ id: t.id, chamber: t.chamber }))).catch(() => null);
  if (!results) return text;
  const invented = new Set(
    tokens.filter((t, i) => {
      const r = results[i];
      return r !== undefined && "deleted" in r && getCachedChamber(t.id) === null;
    }).map((t) => t.token)
  );
  if (invented.size === 0) return text;
  return text.replace(WIKILINK_PATTERN, (full, rawTarget: string, rawAlias?: string) => {
    const parsed = parseExhibitToken(rawTarget.trim().replace(/\\$/, ""));
    if (!parsed || !invented.has(buildExhibitToken(parsed))) return full;
    return rawAlias?.trim() || parsed.id;
  });
}

const ASK_KINDS = new Set(["message", "question", "proposal", "builder_request", "type_publish"]);
const HISTORY_LIMIT = 20;

function describeForContext(m: AiMessage): string {
  const payload = (m.payload ?? {}) as { title?: string | null };
  const title = payload.title ? `"${payload.title}": ` : "";
  const body = m.text.replace(/\s+/g, " ").slice(0, 600);
  if (m.role === "user") return `Owner${m.kind === "answer" ? " (answered)" : m.kind === "decision" ? " (decided)" : ""}: ${body}`;
  if (ASK_KINDS.has(m.kind)) return `Congress ${m.kind}${m.askState ? ` [${m.askState}]` : ""} ${title}${body}`;
  return `Congress: ${body}`;
}

// What this run's CLI session may not know: asks other runs (a tracked
// item's check, a proactive run) posted since the owner last spoke - or,
// for a fresh session, the thread's recent history.
export function threadContext(threadId: number, beforeMessageId: number, fresh: boolean): string | null {
  const earlier = listThreadMessages(threadId, { before: beforeMessageId, limit: HISTORY_LIMIT }).messages;
  if (fresh) {
    if (earlier.length === 0) return null;
    return `## Earlier in this thread\n${earlier.map((m) => `- ${describeForContext(m)}`).join("\n")}`;
  }
  const lastOwner = [...earlier].reverse().findIndex((m) => m.role === "user");
  const since = lastOwner === -1 ? earlier : earlier.slice(earlier.length - lastOwner);
  const asks = since.filter((m) => ASK_KINDS.has(m.kind));
  if (asks.length === 0) return null;
  return `## Posted in this thread since the owner last wrote\n${asks.map((m) => `- ${describeForContext(m)}`).join("\n")}`;
}

export async function ownerMessageBody(text: string, context: string | null = null): Promise<string> {
  const body = chatPromptBody(text, await resolveReferencedExhibits(text));
  return context ? `${context}\n\n${body}` : body;
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
  const runId = startThreadRun(threadId, {
    kind: "chat",
    buildBody: (fresh) => ownerMessageBody(text, threadContext(threadId, userMessage.id, fresh)),
    summaryText: text,
  });
  return { userMessage, runId };
}

// Re-runs the last owner message whose reply failed, was refused or stopped.
export function retryLast(threadId: number): { runId: string } {
  const thread = getThreadRow(threadId);
  if (!thread) throw new ThreadNotFoundError();
  if (thread.pendingRunId) throw new ThreadBusyError();
  const page = listThreadMessages(threadId, { limit: 2 });
  const [prev, last] = page.messages.length === 2 ? page.messages : [undefined, page.messages[0]];
  let owner: AiMessage | null = null;
  if (last?.role === "user") owner = last;
  else if (last && last.role === "assistant" && last.status !== "ok" && prev?.role === "user") {
    deleteMessageRow(last.id);
    owner = prev;
  }
  if (!owner) throw new ThreadBusyError("Nothing to retry.");
  const { id: ownerId, text } = owner;
  const runId = startThreadRun(threadId, {
    kind: "chat",
    buildBody: (fresh) => ownerMessageBody(text, threadContext(threadId, ownerId, fresh)),
    summaryText: text,
  });
  notifyThreadUpdated(threadId);
  return { runId };
}

export interface ThreadRunInput {
  kind: AiRunKind;
  // Built when the run starts (it may resolve exhibits over the network).
  // `fresh`: no CLI session to resume, so include the thread's history.
  buildBody: (fresh: boolean) => Promise<string>;
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
  const common = { kind: input.kind, actor: "congress", threadId, trigger: input.trigger ?? "owner", signal, meta: { threadId } };

  let result: RunOutcome = await runAi({ ...common, body: await input.buildBody(!thread.sessionId), runId: current.runId, resumeSessionId: thread.sessionId });
  if (!result.ok && !result.refused && !result.cancelled && thread.sessionId && result.activity.length === 0 && MISSING_SESSION.test(result.errorMessage ?? "")) {
    current.runId = randomUUID();
    updateThreadRow(threadId, { pendingRunId: current.runId, sessionId: null });
    notifyThreadUpdated(threadId);
    result = await runAi({ ...common, body: await input.buildBody(true), runId: current.runId, resumeSessionId: null });
  }

  // A thread deleted mid-run has nowhere to put the reply.
  if (!getThreadRow(threadId)) return;
  if (result.sessionId) updateThreadRow(threadId, { sessionId: result.sessionId });

  const status = result.refused ? "refused" : result.cancelled ? "cancelled" : result.ok ? "ok" : "error";
  const text =
    status === "ok"
      ? await repairInventedTokens(result.response?.trim() || "(no response)")
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

