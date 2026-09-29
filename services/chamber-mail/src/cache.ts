import { and, desc, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { scoreExhibitMatch } from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { messages, syncState, threadRefs } from "./db/schema.js";
import { categoryOf, headerValue, parseAddress, type RawGmailMessage, type MailCategory } from "./gmail/mime.js";
import type { MessageSummary } from "./types.js";

export function threadExhibitId(accountId: number, threadId: string): string {
  return `thread-${accountId}:${threadId}`;
}

export function parseThreadExhibitId(id: string): { accountId: number; threadId: string } | null {
  const match = id.match(/^thread-(\d+):([A-Za-z0-9]+)$/);
  return match ? { accountId: Number(match[1]), threadId: match[2]! } : null;
}

export function threadUrl(accountId: number, threadId: string): string {
  return `/t/${accountId}/${threadId}`;
}

type MessageRow = typeof messages.$inferSelect;

export function toCacheRow(raw: RawGmailMessage, accountId: number): typeof messages.$inferInsert {
  const headers = raw.payload?.headers;
  const labelIds = raw.labelIds ?? [];
  const from = parseAddress(headerValue(headers, "From"));
  return {
    id: `${accountId}:${raw.id}`,
    accountId,
    messageId: raw.id,
    threadId: raw.threadId,
    fromName: from.name,
    fromEmail: from.email,
    to: headerValue(headers, "To") ?? null,
    subject: headerValue(headers, "Subject")?.trim() || "(no subject)",
    snippet: raw.snippet ?? "",
    internalDate: new Date(Number(raw.internalDate ?? Date.now())),
    labelIds: JSON.stringify(labelIds),
    unread: labelIds.includes("UNREAD"),
    inInbox: labelIds.includes("INBOX"),
    // Metadata responses carry no parts; multipart/mixed is the attachment tell.
    hasAttachments: (raw.payload?.mimeType ?? "").toLowerCase() === "multipart/mixed",
    syncedAt: new Date(),
  };
}

export function toSummary(row: MessageRow): MessageSummary {
  const labelIds = JSON.parse(row.labelIds) as string[];
  return {
    accountId: row.accountId,
    messageId: row.messageId,
    threadId: row.threadId,
    exhibitId: threadExhibitId(row.accountId, row.threadId),
    from: { name: row.fromName, email: row.fromEmail },
    to: row.to,
    subject: row.subject,
    snippet: row.snippet,
    date: row.internalDate.toISOString(),
    unread: row.unread,
    inInbox: row.inInbox,
    category: categoryOf(labelIds),
    labelIds,
    hasAttachments: row.hasAttachments,
    url: threadUrl(row.accountId, row.threadId),
  };
}

export function getCachedMessage(accountId: number, messageId: string): MessageRow | undefined {
  return db.select().from(messages).where(eq(messages.id, `${accountId}:${messageId}`)).get();
}

export function upsertCachedMessage(row: typeof messages.$inferInsert): void {
  db.insert(messages).values(row).onConflictDoUpdate({ target: messages.id, set: row }).run();
}

export function deleteCachedMessage(accountId: number, messageId: string): void {
  db.delete(messages).where(eq(messages.id, `${accountId}:${messageId}`)).run();
}

export interface RecentQuery {
  accountId?: number;
  unreadOnly?: boolean;
  inboxOnly?: boolean;
  categories?: MailCategory[];
  since?: Date;
  limit?: number;
}

export function listCachedMessages(query: RecentQuery = {}): MessageSummary[] {
  const conditions = [
    query.accountId !== undefined ? eq(messages.accountId, query.accountId) : undefined,
    query.unreadOnly ? eq(messages.unread, true) : undefined,
    query.inboxOnly ? eq(messages.inInbox, true) : undefined,
    query.since ? gte(messages.internalDate, query.since) : undefined,
  ].filter((c) => c !== undefined);
  const rows = db
    .select()
    .from(messages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(messages.internalDate))
    .all();
  const summaries = rows.map(toSummary).filter((m) => !query.categories || query.categories.includes(m.category));
  return summaries.slice(0, query.limit ?? 50);
}

// Latest cached message per thread, matched on subject/sender/snippet.
export function searchCachedThreads(query: string, limit = 10): MessageSummary[] {
  const trimmed = query.trim();
  const pattern = `%${trimmed}%`;
  const rows = db
    .select()
    .from(messages)
    .where(
      trimmed
        ? or(like(messages.subject, pattern), like(messages.fromName, pattern), like(messages.fromEmail, pattern), like(messages.snippet, pattern))
        : undefined
    )
    .orderBy(desc(messages.internalDate))
    .limit(trimmed ? 500 : 200)
    .all();
  const latest = new Map<string, MessageRow>();
  for (const row of rows) {
    const key = `${row.accountId}:${row.threadId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const summaries = [...latest.values()].map(toSummary);
  if (!trimmed) return summaries.slice(0, limit);
  return summaries
    .map((m) => ({
      m,
      score: scoreExhibitMatch(trimmed, [
        { text: m.subject, isPrimary: true },
        { text: m.from.name ?? "", isPrimary: false },
        { text: m.from.email ?? "", isPrimary: false },
        { text: m.snippet, isPrimary: false },
      ]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ m }) => m);
}

export function getCachedThreadMessages(accountId: number, threadId: string): MessageSummary[] {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, threadId)))
    .orderBy(messages.internalDate)
    .all()
    .map(toSummary);
}

// Returns how many cached messages flipped to read.
export function markCachedThreadRead(accountId: number, threadId: string): number {
  const rows = db
    .select()
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, threadId), eq(messages.unread, true)))
    .all();
  for (const row of rows) {
    const labelIds = (JSON.parse(row.labelIds) as string[]).filter((l) => l !== "UNREAD");
    db.update(messages).set({ unread: false, labelIds: JSON.stringify(labelIds) }).where(eq(messages.id, row.id)).run();
  }
  return rows.length;
}

export function listCachedThreadIds(accountId: number): string[] {
  return db
    .selectDistinct({ threadId: messages.threadId })
    .from(messages)
    .where(eq(messages.accountId, accountId))
    .all()
    .map((r) => r.threadId);
}

export function pruneCachedMessages(before: Date): number {
  return db.delete(messages).where(lt(messages.internalDate, before)).run().changes;
}

export function countCachedMessages(accountId: number): number {
  return db.select({ n: sql<number>`count(*)` }).from(messages).where(eq(messages.accountId, accountId)).get()?.n ?? 0;
}

// Everything tied to an account the owner disconnected.
export function forgetAccount(accountId: number): void {
  db.transaction((tx) => {
    tx.delete(messages).where(eq(messages.accountId, accountId)).run();
    tx.delete(syncState).where(eq(syncState.accountId, accountId)).run();
    tx.delete(threadRefs).where(like(threadRefs.exhibitId, `thread-${accountId}:%`)).run();
  });
}

export function cachedMessagesByIds(accountId: number, messageIds: string[]): MessageRow[] {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(messages)
    .where(inArray(messages.id, messageIds.map((id) => `${accountId}:${id}`)))
    .all();
}
