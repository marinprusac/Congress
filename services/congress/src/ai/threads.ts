import { and, desc, eq, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { AiAskState, AiMessage, AiMessageKind, AiMessageRole, AiMessageStatus, AiThread, AiUrgency } from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiMessages, aiThreads } from "../db/schema.js";
import { runSummaries } from "./runs.js";

type ThreadRow = typeof aiThreads.$inferSelect;
type MessageRow = typeof aiMessages.$inferSelect;

export const DEFAULT_THREAD_TITLE = "New chat";
const SNIPPET_LENGTH = 140;

// A message is visible once its deliverAt (if any) has passed.
function visibleNow(now = new Date()) {
  return or(isNull(aiMessages.deliverAt), lte(aiMessages.deliverAt, now));
}

export function titleFromText(text: string): string {
  const flat = text.replace(/\[\[exhibit:[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat || DEFAULT_THREAD_TITLE;
  const cut = flat.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// A message as one plain line for the thread list: chips become their
// labels and Markdown syntax (tables, emphasis, links, headings) is dropped.
export function plainSnippet(text: string): string {
  return text
    .replace(/\[\[exhibit:[^\]|]+?\\?\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[exhibit:[^\]]+\]\]/g, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_LENGTH);
}

function toThread(row: ThreadRow, extras: { snippet: string | null; openAskCount: number }): AiThread {
  const lastReadAt = row.lastReadAt?.getTime() ?? 0;
  return {
    id: row.id,
    title: row.title ?? DEFAULT_THREAD_TITLE,
    origin: row.origin,
    trackingId: row.trackingId,
    pinned: row.pinnedAt !== null,
    archived: row.archivedAt !== null,
    unread: row.lastMessageAt.getTime() > lastReadAt,
    openAskCount: extras.openAskCount,
    pendingRunId: row.pendingRunId,
    snippet: extras.snippet,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function threadExtras(threadId: number): { snippet: string | null; openAskCount: number } {
  const now = new Date();
  const last = db
    .select({ text: aiMessages.text })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), visibleNow(now)))
    .orderBy(desc(aiMessages.id))
    .limit(1)
    .get();
  const open = db
    .select({ count: sql<number>`count(*)` })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), eq(aiMessages.askState, "open"), visibleNow(now)))
    .get();
  return { snippet: last ? plainSnippet(last.text) || null : null, openAskCount: open?.count ?? 0 };
}

export function listThreads(opts: { archived?: boolean } = {}): AiThread[] {
  const rows = db
    .select()
    .from(aiThreads)
    .where(opts.archived ? isNotNull(aiThreads.archivedAt) : isNull(aiThreads.archivedAt))
    .orderBy(desc(aiThreads.lastMessageAt))
    .all();
  return rows.map((row) => toThread(row, threadExtras(row.id)));
}

export function getThreadRow(id: number): ThreadRow | null {
  return db.select().from(aiThreads).where(eq(aiThreads.id, id)).get() ?? null;
}

export function getThread(id: number): AiThread | null {
  const row = getThreadRow(id);
  return row ? toThread(row, threadExtras(id)) : null;
}

export function insertThread(input: { title?: string | null; origin?: "owner" | "ai"; trackingId?: number | null }): ThreadRow {
  const now = new Date();
  return db
    .insert(aiThreads)
    .values({
      title: input.title ?? null,
      origin: input.origin ?? "owner",
      trackingId: input.trackingId ?? null,
      lastMessageAt: now,
      lastReadAt: now,
      createdAt: now,
    })
    .returning()
    .get();
}

export function updateThreadRow(id: number, patch: Partial<Omit<ThreadRow, "id">>): ThreadRow | null {
  return db.update(aiThreads).set(patch).where(eq(aiThreads.id, id)).returning().get() ?? null;
}

export function deleteThreadRow(id: number): boolean {
  return db.transaction((tx) => {
    tx.delete(aiMessages).where(eq(aiMessages.threadId, id)).run();
    return tx.delete(aiThreads).where(eq(aiThreads.id, id)).run().changes > 0;
  });
}

export function markThreadRead(id: number): void {
  db.update(aiThreads).set({ lastReadAt: new Date() }).where(eq(aiThreads.id, id)).run();
}

export function listPendingThreadRows(): ThreadRow[] {
  return db.select().from(aiThreads).where(isNotNull(aiThreads.pendingRunId)).all();
}

function parsePayload(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toMessages(rows: MessageRow[]): AiMessage[] {
  const runs = runSummaries(rows.map((r) => r.runId).filter((id): id is string => id !== null));
  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    kind: row.kind,
    status: row.status,
    text: row.text,
    runId: row.runId,
    run: row.runId ? (runs.get(row.runId) ?? null) : null,
    payload: parsePayload(row.payloadJson),
    askState: row.askState,
    urgency: row.urgency,
    deliverAt: row.deliverAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export const MESSAGE_PAGE_SIZE = 50;

// Newest-last page, walking backwards from `before` (a message id).
export function listThreadMessages(threadId: number, opts: { before?: number; limit?: number } = {}): { messages: AiMessage[]; hasMore: boolean } {
  const limit = opts.limit ?? MESSAGE_PAGE_SIZE;
  const rows = db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), visibleNow(), opts.before ? lt(aiMessages.id, opts.before) : undefined))
    .orderBy(desc(aiMessages.id))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  return { messages: toMessages(rows.slice(0, limit).reverse()), hasMore };
}

export function getMessage(id: number): AiMessage | null {
  const row = db.select().from(aiMessages).where(eq(aiMessages.id, id)).get();
  return row ? (toMessages([row])[0] ?? null) : null;
}

export function lastVisibleMessage(threadId: number): AiMessage | null {
  const row = db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, threadId), visibleNow()))
    .orderBy(desc(aiMessages.id))
    .limit(1)
    .get();
  return row ? (toMessages([row])[0] ?? null) : null;
}

export interface NewMessage {
  threadId: number;
  role: AiMessageRole;
  kind?: AiMessageKind;
  status?: AiMessageStatus;
  text: string;
  runId?: string | null;
  payload?: unknown;
  askState?: AiAskState | null;
  urgency?: AiUrgency | null;
  deliverAt?: Date | null;
  expiresAt?: Date | null;
}

// Also bumps the thread's lastMessageAt (at delivery time for a delayed one).
export function insertMessage(input: NewMessage): AiMessage {
  const now = new Date();
  const row = db
    .insert(aiMessages)
    .values({
      threadId: input.threadId,
      role: input.role,
      kind: input.kind ?? "text",
      status: input.status ?? "ok",
      text: input.text,
      runId: input.runId ?? null,
      payloadJson: input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
      askState: input.askState ?? null,
      urgency: input.urgency ?? null,
      deliverAt: input.deliverAt ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
    })
    .returning()
    .get();
  if (!input.deliverAt || input.deliverAt <= now) {
    const patch: Partial<ThreadRow> = { lastMessageAt: now };
    if (input.role === "user") patch.lastReadAt = now;
    db.update(aiThreads).set(patch).where(eq(aiThreads.id, input.threadId)).run();
  }
  return toMessages([row])[0] as AiMessage;
}

export function updateMessageRow(id: number, patch: Partial<Omit<MessageRow, "id">>): AiMessage | null {
  const row = db.update(aiMessages).set(patch).where(eq(aiMessages.id, id)).returning().get();
  return row ? (toMessages([row])[0] ?? null) : null;
}

export function deleteMessageRow(id: number): void {
  db.delete(aiMessages).where(eq(aiMessages.id, id)).run();
}
