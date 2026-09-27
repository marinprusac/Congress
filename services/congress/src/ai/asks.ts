import { and, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import {
  answerSchemaFor,
  askProposalPayloadSchema,
  askQuestionPayloadSchema,
  type AiMessage,
  type AiUrgency,
  type AskAnswers,
  type AskField,
  type AskFieldInput,
  type AskProposalPayload,
  type AskQuestionPayload,
  type OpenAsk,
  type ProposalResult,
  type ProposedAction,
} from "@congress/shared-types";
import { callChamberTool } from "@congress/chamber-kit";
import { db } from "../db/client.js";
import { aiMessages, aiThreads } from "../db/schema.js";
import { env } from "../env.js";
import { getChamber } from "../registry.js";
import { dismissNotificationByKey, pushNotification } from "../notifications.js";
import { getAiSettings } from "./settings.js";
import { decidePush, startOfLocalDay, type PushDecision } from "./pushPolicy.js";
import { getMessage, getThreadRow, insertMessage, insertThread, plainSnippet, updateMessageRow, updateThreadRow } from "./threads.js";
import { notifyThreadUpdated } from "./runStream.js";
import { startThreadRun } from "./chat.js";
import { selfBaseUrl } from "./mcpConfig.js";

export class AskNotFoundError extends Error {}
export class AskClosedError extends Error {}
export class AskInvalidError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {}
  ) {
    super(message);
  }
}

export interface AskOrigin {
  runId: string | null;
  threadId: number | null;
}

// Asks from one run without a thread (a Chamber's run) share one new thread.
const runThreads = new Map<string, number>();

function targetThread(origin: AskOrigin, title: string): number {
  if (origin.threadId && getThreadRow(origin.threadId)) return origin.threadId;
  const known = origin.runId ? runThreads.get(origin.runId) : undefined;
  if (known && getThreadRow(known)) return known;
  const thread = insertThread({ title, origin: "ai" });
  // An AI-started thread is unread until the owner opens it.
  updateThreadRow(thread.id, { lastReadAt: null });
  if (origin.runId) runThreads.set(origin.runId, thread.id);
  return thread.id;
}

// The thread a run's asks opened, if it had none of its own.
export function threadForRun(runId: string): number | null {
  return runThreads.get(runId) ?? null;
}

const dedupeKey = (messageId: number) => `ask-${messageId}`;

async function pushesToday(now: Date, timeZone: string | null): Promise<number> {
  return db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(and(isNotNull(aiMessages.pushedAt), gte(aiMessages.pushedAt, startOfLocalDay(now, timeZone))))
    .all().length;
}

export async function pushBudget(now = new Date()): Promise<{ pushesLeftToday: number; quietHoursNow: boolean }> {
  const s = await getAiSettings();
  const used = await pushesToday(now, s.timeZone);
  const decision = decidePush({ ...s, urgency: "push", at: now, pushedToday: used });
  return { pushesLeftToday: Math.max(0, s.maxPushesPerDay - used), quietHoursNow: decision === "quiet_hours" };
}

// The ask reaches the owner: inbox row always, a device push only if allowed.
async function deliver(messageId: number, now = new Date()): Promise<PushDecision> {
  const message = getMessage(messageId);
  if (!message) return "quiet";
  const thread = getThreadRow(message.threadId);
  const s = await getAiSettings();
  const decision = decidePush({ ...s, urgency: message.urgency ?? "quiet", at: now, pushedToday: await pushesToday(now, s.timeZone) });
  const title = askTitle(message) || thread?.title || "Congress";
  pushNotification(
    { chamber: "congress", dedupeKey: dedupeKey(messageId), title, body: plainSnippet(message.text) || undefined, chamberUrl: `/chat/${message.threadId}` },
    { silent: decision !== "push" }
  );
  updateMessageRow(messageId, { deliveredAt: now, ...(decision === "push" ? { pushedAt: now } : {}) });
  if (thread) updateThreadRow(thread.id, { lastMessageAt: now, archivedAt: null });
  notifyThreadUpdated(message.threadId);
  return decision;
}

function askTitle(message: AiMessage): string {
  const payload = message.payload as { title?: string | null } | null;
  return payload?.title ?? "";
}

interface NewAsk {
  kind: "message" | "question" | "proposal";
  title: string;
  text: string;
  payload: unknown;
  urgency: AiUrgency;
  deliverAt?: Date | null;
  expiresAt?: Date | null;
}

// Models sometimes double-escape newlines in tool arguments ("\\n" text).
export function unescapeNewlines(text: string): string {
  return text.includes("\n") ? text : text.replace(/\\n/g, "\n").replace(/\\t/g, "  ");
}

async function createAsk(ask: NewAsk, origin: AskOrigin): Promise<{ message: AiMessage; delivery: PushDecision | "scheduled" }> {
  ask = { ...ask, text: unescapeNewlines(ask.text) };
  const threadId = targetThread(origin, ask.title);
  const delayed = ask.deliverAt && ask.deliverAt.getTime() > Date.now();
  const message = insertMessage({
    threadId,
    role: "assistant",
    kind: ask.kind,
    text: ask.text,
    runId: origin.runId,
    payload: ask.payload,
    askState: ask.kind === "message" ? null : "open",
    urgency: ask.urgency,
    deliverAt: delayed ? ask.deliverAt : null,
    expiresAt: ask.expiresAt ?? null,
  });
  const delivery = delayed ? "scheduled" : await deliver(message.id);
  rearmAskTimer();
  return { message, delivery };
}

export function sendMessage(input: { title?: string | null; body: string; urgency: AiUrgency; deliverAt?: Date | null; links?: string[] }, origin: AskOrigin) {
  return createAsk(
    {
      kind: "message",
      title: input.title ?? "",
      text: input.body,
      payload: { title: input.title ?? null, links: input.links ?? [] },
      urgency: input.urgency,
      deliverAt: input.deliverAt,
    },
    origin
  );
}

export function askQuestion(
  input: { title: string; prompt: string; fields: AskFieldInput[]; submitLabel?: string | null; urgency: AiUrgency; expiresAt?: Date | null },
  origin: AskOrigin
) {
  const parsed = askQuestionPayloadSchema.safeParse({ title: input.title, fields: input.fields, submitLabel: input.submitLabel ?? null });
  if (!parsed.success) throw new AskInvalidError(formatIssues(parsed.error.issues));
  return createAsk({ kind: "question", title: input.title, text: input.prompt, payload: parsed.data, urgency: input.urgency, expiresAt: input.expiresAt }, origin);
}

// The server a proposed call targets must exist and speak MCP.
function mcpUrlFor(server: string): string | null {
  if (server === "congress") return `${selfBaseUrl()}/mcp`;
  const chamber = getChamber(server);
  return chamber?.status === "active" && chamber.mcpUrl ? chamber.mcpUrl : null;
}

export function normalizeToolName(server: string, tool: string): string {
  const prefix = `mcp__${server}__`;
  return tool.startsWith(prefix) ? tool.slice(prefix.length) : tool;
}

export function proposeActions(input: { title: string; rationale: string; actions: ProposedAction[]; urgency: AiUrgency }, origin: AskOrigin) {
  const parsed = askProposalPayloadSchema.safeParse({ title: input.title, actions: input.actions });
  if (!parsed.success) throw new AskInvalidError(formatIssues(parsed.error.issues));
  const unknown = parsed.data.actions.filter((a) => !mcpUrlFor(a.server)).map((a) => a.server);
  if (unknown.length) throw new AskInvalidError(`Unknown or offline server(s): ${[...new Set(unknown)].join(", ")}`);
  const actions = parsed.data.actions.map((a) => ({ ...a, tool: normalizeToolName(a.server, a.tool) }));
  return createAsk({ kind: "proposal", title: input.title, text: input.rationale, payload: { ...parsed.data, actions }, urgency: input.urgency }, origin);
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
}

function requireOpenAsk(messageId: number, kind: "question" | "proposal"): AiMessage {
  const message = getMessage(messageId);
  if (!message || message.kind !== kind) throw new AskNotFoundError();
  if (message.askState !== "open") throw new AskClosedError(`This ${kind} is ${message.askState}.`);
  return message;
}

// An undelivered reminder is cancelled; an open question/proposal withdrawn.
// A delivered message can't be unsent.
export function withdrawAsk(messageId: number): AiMessage {
  const message = getMessage(messageId);
  if (!message || !["message", "question", "proposal"].includes(message.kind)) throw new AskNotFoundError();
  if (message.kind === "message") {
    if (isDelivered(messageId)) throw new AskClosedError("It was already delivered and can't be unsent.");
    db.delete(aiMessages).where(eq(aiMessages.id, messageId)).run();
    rearmAskTimer();
    return message;
  }
  if (message.askState !== "open") throw new AskClosedError(`It is already ${message.askState}.`);
  const updated = updateMessageRow(messageId, { askState: "withdrawn" });
  dismissNotificationByKey("congress", dedupeKey(messageId));
  notifyThreadUpdated(message.threadId);
  rearmAskTimer();
  return updated ?? message;
}

function isDelivered(messageId: number): boolean {
  return db.select({ at: aiMessages.deliveredAt }).from(aiMessages).where(eq(aiMessages.id, messageId)).get()?.at != null;
}

function formatValue(field: AskField, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "choice") return field.options.find((o) => o.value === value)?.label ?? String(value);
  if (field.type === "multichoice" && Array.isArray(value)) {
    return value.map((v) => field.options.find((o) => o.value === v)?.label ?? v).join(", ") || "—";
  }
  if (field.type === "number" && field.unit) return `${value} ${field.unit}`;
  return String(value);
}

export function answerSummary(fields: AskField[], answers: AskAnswers): string {
  return fields.map((f) => `- **${f.label}:** ${formatValue(f, answers[f.key])}`).join("\n");
}

export function answerQuestion(messageId: number, values: Record<string, unknown>): { message: AiMessage; runId: string } {
  const message = requireOpenAsk(messageId, "question");
  const payload = askQuestionPayloadSchema.parse(message.payload);
  const result = answerSchemaFor(payload.fields).safeParse(values);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "");
      fieldErrors[key] ??= issue.code === "unrecognized_keys" ? "Unknown field" : issue.message === "Required" || issue.message.startsWith("Expected") ? "Required" : issue.message;
    }
    throw new AskInvalidError("Some answers need another look.", fieldErrors);
  }
  const answers = result.data as AskAnswers;
  const updated = updateMessageRow(messageId, {
    askState: "answered",
    payloadJson: JSON.stringify({ ...payload, answer: answers } satisfies AskQuestionPayload),
  });
  dismissNotificationByKey("congress", dedupeKey(messageId));
  const summary = answerSummary(payload.fields, answers);
  insertMessage({ threadId: message.threadId, role: "user", kind: "answer", text: summary, payload: { questionId: messageId } });
  const runId = startThreadRun(message.threadId, {
    kind: "answer",
    trigger: "answer",
    summaryText: summary,
    buildBody: async () =>
      `## The owner answered your question "${payload.title}"\n${message.text}\n\n### Answers\n${summary}\n\nAct on the answers as appropriate, then reply briefly.`,
  });
  rearmAskTimer();
  return { message: updated ?? message, runId };
}

async function executeProposal(messageId: number, payload: AskProposalPayload, threadId: number): Promise<void> {
  const results: ProposalResult[] = [];
  let failed = false;
  for (const action of payload.actions) {
    if (failed) {
      results.push({ ok: false, output: null, error: "Skipped after an earlier step failed." });
      continue;
    }
    const url = mcpUrlFor(action.server);
    try {
      if (!url) throw new Error(`${action.server} is not available.`);
      const res = (await callChamberTool(url, env.CONGRESS_INTERNAL_TOKEN, action.tool, action.args, "congress")) as {
        isError?: boolean;
        content?: unknown;
      };
      const ok = res.isError !== true;
      results.push({ ok, output: res.content ?? null, error: ok ? null : JSON.stringify(res.content ?? "Tool reported an error") });
      if (!ok) failed = true;
    } catch (err) {
      results.push({ ok: false, output: null, error: (err as Error).message });
      failed = true;
    }
  }
  updateMessageRow(messageId, {
    askState: failed ? "failed" : "executed",
    payloadJson: JSON.stringify({ ...payload, results } satisfies AskProposalPayload),
  });
  notifyThreadUpdated(threadId);
  const lines = payload.actions.map((a, i) => {
    const r = results[i];
    const outcome = r?.ok ? `done, returned: ${JSON.stringify(r.output).slice(0, 600)}` : `failed: ${r?.error ?? "unknown"}`;
    return `${i + 1}. ${a.summary} (${a.server}.${a.tool}) - ${outcome}`;
  });
  startThreadRun(threadId, {
    kind: "answer",
    trigger: "decision",
    summaryText: `Approved: ${payload.title}`,
    buildBody: async () =>
      `## The owner approved your proposal "${payload.title}"\nCongress executed the calls exactly as proposed:\n${lines.join("\n")}\n\n${failed ? "Something failed - explain briefly and suggest a fix (a new proposal if it needs approval again)." : "Confirm briefly what changed. To mention something that was created, get its chip with get_exhibit_chip (the chamber plus the id in the result) - never write a token yourself."}`,
  });
}

export function decideProposal(messageId: number, approve: boolean, note?: string): AiMessage {
  const message = requireOpenAsk(messageId, "proposal");
  const payload = askProposalPayloadSchema.parse(message.payload);
  dismissNotificationByKey("congress", dedupeKey(messageId));
  const decisionText = approve ? "Approved." : note ? `Rejected: ${note}` : "Rejected.";
  insertMessage({ threadId: message.threadId, role: "user", kind: "decision", text: decisionText, payload: { proposalId: messageId, approve } });
  if (approve) {
    const updated = updateMessageRow(messageId, { askState: "approved" });
    notifyThreadUpdated(message.threadId);
    void executeProposal(messageId, payload, message.threadId).catch((err) => console.warn("Proposal execution failed:", err));
    return updated ?? message;
  }
  const updated = updateMessageRow(messageId, {
    askState: "rejected",
    payloadJson: JSON.stringify({ ...payload, note: note ?? null } satisfies AskProposalPayload),
  });
  startThreadRun(message.threadId, {
    kind: "answer",
    trigger: "decision",
    summaryText: decisionText,
    buildBody: async () =>
      `## The owner rejected your proposal "${payload.title}"\n${note ? `Their note: ${note}\n` : ""}Don't make these changes. Acknowledge briefly${note ? " and take the note into account" : ""}.`,
  });
  return updated ?? message;
}

// Open questions/proposals, plus fresh messages in threads not yet read.
export function listOpenAsks(now = new Date()): OpenAsk[] {
  const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const rows = db
    .select({ m: aiMessages, threadTitle: aiThreads.title, lastReadAt: aiThreads.lastReadAt })
    .from(aiMessages)
    .innerJoin(aiThreads, eq(aiThreads.id, aiMessages.threadId))
    .where(
      and(
        isNotNull(aiMessages.deliveredAt),
        or(
          and(or(eq(aiMessages.kind, "question"), eq(aiMessages.kind, "proposal")), eq(aiMessages.askState, "open")),
          and(eq(aiMessages.kind, "message"), gte(aiMessages.deliveredAt, recent))
        )
      )
    )
    .orderBy(desc(aiMessages.deliveredAt))
    .limit(30)
    .all();
  return rows
    .filter(({ m, lastReadAt }) => m.kind !== "message" || !lastReadAt || (m.deliveredAt && m.deliveredAt > lastReadAt))
    .map(({ m, threadTitle }) => {
      const message = getMessage(m.id) as AiMessage;
      return {
        messageId: m.id,
        threadId: m.threadId,
        threadTitle: threadTitle ?? "Congress",
        kind: m.kind as OpenAsk["kind"],
        title: askTitle(message),
        text: m.text,
        payload: message.payload,
        createdAt: (m.deliveredAt ?? m.createdAt).toISOString(),
      };
    });
}

// ---- Delivery and expiry timer ----

const MAX_TIMEOUT_MS = 24 * 24 * 60 * 60 * 1000;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function nextWakeMs(): number | null {
  const due = db
    .select({ at: aiMessages.deliverAt })
    .from(aiMessages)
    .where(and(isNull(aiMessages.deliveredAt), isNotNull(aiMessages.deliverAt)))
    .orderBy(aiMessages.deliverAt)
    .limit(1)
    .get();
  const expiry = db
    .select({ at: aiMessages.expiresAt })
    .from(aiMessages)
    .where(and(eq(aiMessages.askState, "open"), isNotNull(aiMessages.expiresAt)))
    .orderBy(aiMessages.expiresAt)
    .limit(1)
    .get();
  const times = [due?.at, expiry?.at].filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return times.length ? Math.min(...times) : null;
}

// A reminder belongs where it arrives, not where it was written: re-add it
// at the end of its thread (threads are ordered by id).
function moveToEnd(messageId: number, now: Date): number {
  return db.transaction((tx) => {
    const row = tx.select().from(aiMessages).where(eq(aiMessages.id, messageId)).get();
    if (!row) return messageId;
    const { id: _id, ...rest } = row;
    const fresh = tx.insert(aiMessages).values({ ...rest, deliverAt: null, createdAt: now }).returning({ id: aiMessages.id }).get();
    tx.delete(aiMessages).where(eq(aiMessages.id, messageId)).run();
    return fresh.id;
  });
}

export async function runAskTimerTick(now = new Date()): Promise<void> {
  const dueDeliveries = db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(and(isNull(aiMessages.deliveredAt), isNotNull(aiMessages.deliverAt), lte(aiMessages.deliverAt, now)))
    .all();
  for (const { id } of dueDeliveries) await deliver(moveToEnd(id, now), now);
  const expired = db
    .select({ id: aiMessages.id, threadId: aiMessages.threadId })
    .from(aiMessages)
    .where(and(eq(aiMessages.askState, "open"), isNotNull(aiMessages.expiresAt), lte(aiMessages.expiresAt, now)))
    .all();
  for (const row of expired) {
    updateMessageRow(row.id, { askState: "expired" });
    dismissNotificationByKey("congress", dedupeKey(row.id));
    notifyThreadUpdated(row.threadId);
  }
}

export function rearmAskTimer(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!running) return;
  const next = nextWakeMs();
  if (next === null) return;
  const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS);
  timer = setTimeout(() => {
    void runAskTimerTick()
      .catch((err) => console.warn("Ask timer failed:", err))
      .finally(rearmAskTimer);
  }, delay);
}

export function startAskTimer(): void {
  running = true;
  void runAskTimerTick().finally(rearmAskTimer);
}

export function stopAskTimer(): void {
  running = false;
  if (timer) clearTimeout(timer);
}

// Reading a thread clears its messages' inbox entries; open questions and
// proposals keep theirs until they're answered.
export function clearReadMessageNotifications(threadId: number): void {
  const rows = db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), eq(aiMessages.kind, "message"), isNotNull(aiMessages.deliveredAt)))
    .all();
  for (const { id } of rows) dismissNotificationByKey("congress", dedupeKey(id));
}

// The AI's own view: what it is still waiting on, pending reminders, and
// what it told the owner in the last day (to avoid repeating itself).
export async function listAsksForAi(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = db
    .select()
    .from(aiMessages)
    .where(
      or(
        and(or(eq(aiMessages.kind, "question"), eq(aiMessages.kind, "proposal")), eq(aiMessages.askState, "open")),
        and(eq(aiMessages.kind, "message"), or(isNull(aiMessages.deliveredAt), gte(aiMessages.deliveredAt, dayAgo)))
      )
    )
    .orderBy(desc(aiMessages.id))
    .limit(40)
    .all();
  return {
    asks: rows.map((m) => ({
      messageId: m.id,
      threadId: m.threadId,
      kind: m.kind,
      state: m.kind === "message" ? (m.deliveredAt ? "delivered" : "scheduled") : m.askState,
      title: askTitle(getMessage(m.id) as AiMessage),
      text: m.text.slice(0, 300),
      deliverAt: m.deliverAt?.toISOString() ?? null,
      expiresAt: m.expiresAt?.toISOString() ?? null,
    })),
    ...(await pushBudget(now)),
  };
}
