import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { ConnectorContext, SourceRecord } from "../contract.js";
import { gmailDb as db } from "./db/client.js";
import { accounts, peopleSkip, settings, threadAddresses, threads } from "./db/schema.js";
import { categoryOf, headerValue, parseAddress, type RawGmailMessage } from "./mime.js";
import type { RawThread } from "./api.js";

type ThreadRow = typeof threads.$inferSelect;

export const threadKey = (accountId: number, threadId: string) => `${accountId}:${threadId}`;

export function parseThreadKey(key: string): { accountId: number; threadId: string } | null {
  const m = key.match(/^(\d+):([A-Za-z0-9]+)$/);
  return m ? { accountId: Number(m[1]), threadId: m[2]! } : null;
}

export const gmailThreadUrl = (email: string, threadId: string) => `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#all/${threadId}`;

const DROP = ["DRAFT", "SPAM", "TRASH"];

// A thread's messages that count: no drafts, spam or trash.
export const liveMessages = (raw: RawThread) => (raw.messages ?? []).filter((m) => !(m.labelIds ?? []).some((l) => DROP.includes(l)));

function splitAddresses(value: string | undefined): { name: string | null; email: string }[] {
  if (!value) return [];
  // Commas inside quoted names don't split.
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  return parts.flatMap((p) => {
    const a = parseAddress(p.trim());
    return a.email ? [{ name: a.name, email: a.email.toLowerCase() }] : [];
  });
}

export interface Summary {
  row: ThreadRow;
  addresses: { email: string; name: string | null; sentTo: boolean }[];
}

// Pure: a thread's cache row and addresses, the owner's own addresses left out.
export function summarize(accountId: number, raw: RawThread, own: Set<string>): Summary | null {
  const msgs = liveMessages(raw).sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  if (!first || !last) return null;
  const labels = [...new Set(msgs.flatMap((m) => m.labelIds ?? []))];
  const from = parseAddress(headerValue(last.payload?.headers, "From"));
  const addresses = new Map<string, { email: string; name: string | null; sentTo: boolean }>();
  const add = (a: { name: string | null; email: string }, sentTo: boolean) => {
    if (own.has(a.email)) return;
    const prev = addresses.get(a.email);
    addresses.set(a.email, { email: a.email, name: prev?.name ?? a.name, sentTo: (prev?.sentTo ?? false) || sentTo });
  };
  for (const m of msgs) {
    const h = m.payload?.headers;
    const sent = (m.labelIds ?? []).includes("SENT");
    for (const a of splitAddresses(headerValue(h, "From"))) add(a, false);
    for (const a of splitAddresses(headerValue(h, "To"))) add(a, sent);
    for (const a of splitAddresses(headerValue(h, "Cc"))) add(a, false);
  }
  return {
    row: {
      key: threadKey(accountId, raw.id),
      accountId,
      threadId: raw.id,
      subject: headerValue(first.payload?.headers, "Subject")?.trim() || "(no subject)",
      fromName: from.name,
      fromEmail: from.email?.toLowerCase() ?? null,
      lastAt: Number(last.internalDate ?? 0),
      snippet: last.snippet ?? "",
      messageCount: msgs.length,
      unread: msgs.some((m) => (m.labelIds ?? []).includes("UNREAD")),
      inbox: labels.includes("INBOX"),
      labelIds: JSON.stringify(labels),
      hasAttachments: msgs.some((m) => (m.payload?.mimeType ?? "").toLowerCase() === "multipart/mixed"),
      messageIds: JSON.stringify(msgs.map((m) => m.id)),
      syncedAt: new Date(),
    },
    addresses: [...addresses.values()],
  };
}

// Upserts a thread and its addresses, keeping People already linked.
export function writeThread(s: Summary): void {
  const key = s.row.key;
  db.transaction((tx) => {
    tx.insert(threads).values(s.row).onConflictDoUpdate({ target: threads.key, set: s.row }).run();
    const prev = new Map(tx.select().from(threadAddresses).where(eq(threadAddresses.threadKey, key)).all().map((a) => [a.email, a.personId]));
    tx.delete(threadAddresses).where(eq(threadAddresses.threadKey, key)).run();
    for (const a of s.addresses) {
      tx.insert(threadAddresses).values({ threadKey: key, email: a.email, name: a.name, sentTo: a.sentTo, personId: prev.get(a.email) ?? null }).run();
    }
  });
}

export function removeThread(key: string): boolean {
  return db.transaction((tx) => {
    tx.delete(threadAddresses).where(eq(threadAddresses.threadKey, key)).run();
    return tx.delete(threads).where(eq(threads.key, key)).run().changes > 0;
  });
}

export const getThreadRow = (key: string): ThreadRow | undefined => db.select().from(threads).where(eq(threads.key, key)).get();

export function listThreadRows(opts: { from?: string; to?: string } = {}): ThreadRow[] {
  const conds = [opts.from ? gte(threads.lastAt, Date.parse(opts.from)) : undefined, opts.to ? lte(threads.lastAt, Date.parse(opts.to)) : undefined].filter(
    (c) => c !== undefined
  );
  return db.select().from(threads).where(conds.length ? and(...conds) : undefined).orderBy(desc(threads.lastAt)).all();
}

export const addressesOf = (key: string) => db.select().from(threadAddresses).where(eq(threadAddresses.threadKey, key)).all();

// Links addresses to People: To of the owner's sent mail may create one (once
// allowed), everyone else only matches an existing Person. Returns whether any changed.
export function linkPeople(ctx: ConnectorContext, key: string): boolean {
  const create = getSettings().createPeople;
  let changed = false;
  for (const a of db.select().from(threadAddresses).where(and(eq(threadAddresses.threadKey, key), isNull(threadAddresses.personId))).all()) {
    const mayCreate = a.sentTo && create && !db.select().from(peopleSkip).where(eq(peopleSkip.email, a.email)).get();
    const id = mayCreate ? ctx.people.resolve({ email: a.email, name: a.name }, "corresponded") : ctx.people.find(a.email);
    if (!id) continue;
    db.update(threadAddresses).set({ personId: id }).where(and(eq(threadAddresses.threadKey, key), eq(threadAddresses.email, a.email))).run();
    changed = true;
  }
  return changed;
}

// Addresses the owner wrote to that aren't linked to a Person yet.
export function unlinkedSentTo(): { email: string; name: string | null }[] {
  return db
    .selectDistinct({ email: threadAddresses.email, name: threadAddresses.name })
    .from(threadAddresses)
    .where(and(eq(threadAddresses.sentTo, true), isNull(threadAddresses.personId)))
    .all();
}

export function skipPeople(emails: string[]): void {
  for (const email of emails) db.insert(peopleSkip).values({ email }).onConflictDoNothing().run();
}

// Each account's scopes and label, refreshed every sync (facts need them without a ctx).
const accountInfo = new Map<number, { email: string; label: string; modify: boolean }>();
export function rememberAccounts(list: { id: number; email: string; label: string; modify: boolean }[]): void {
  accountInfo.clear();
  for (const a of list) accountInfo.set(a.id, a);
}

export function toSourceRecord(row: ThreadRow): SourceRecord {
  const labels = JSON.parse(row.labelIds) as string[];
  const account = accountInfo.get(row.accountId);
  const people = addressesOf(row.key).flatMap((a) => (a.personId ? [a.personId] : []));
  return {
    kind: "thread",
    key: row.key,
    values: {
      subject: row.subject,
      from: row.fromName ? (row.fromEmail ? `${row.fromName} <${row.fromEmail}>` : row.fromName) : (row.fromEmail ?? ""),
      lastAt: new Date(row.lastAt).toISOString(),
      snippet: row.snippet,
      messageCount: row.messageCount,
      unread: row.unread,
      inbox: row.inbox,
      category: categoryOf(labels),
      starred: labels.includes("STARRED"),
      important: labels.includes("IMPORTANT"),
      sent: labels.includes("SENT"),
      hasAttachments: row.hasAttachments,
      account: account ? account.label || account.email : String(row.accountId),
      gmailLink: account ? gmailThreadUrl(account.email, row.threadId) : null,
      people,
    },
    facts: { canMarkRead: row.unread && Boolean(account?.modify) },
    updatedAt: row.syncedAt.toISOString(),
  };
}

// --- accounts and settings

export const getAccountState = (accountId: number) => db.select().from(accounts).where(eq(accounts.accountId, accountId)).get();

export function setAccountState(accountId: number, values: Partial<typeof accounts.$inferInsert>): void {
  db.insert(accounts)
    .values({ accountId, ...values })
    .onConflictDoUpdate({ target: accounts.accountId, set: values })
    .run();
}

export const listAccountStates = () => db.select().from(accounts).all();

// Everything tied to an account the owner disconnected; the removed thread keys.
export function forgetAccount(accountId: number): string[] {
  const keys = db.select({ key: threads.key }).from(threads).where(eq(threads.accountId, accountId)).all().map((r) => r.key);
  db.transaction((tx) => {
    for (const key of keys) tx.delete(threadAddresses).where(eq(threadAddresses.threadKey, key)).run();
    tx.delete(threads).where(eq(threads.accountId, accountId)).run();
    tx.delete(accounts).where(eq(accounts.accountId, accountId)).run();
  });
  return keys;
}

export type GmailSettings = { includeAllCategories: boolean; publishEvents: boolean; createPeople: boolean };

export function getSettings(): GmailSettings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  return {
    includeAllCategories: row?.includeAllCategories ?? false,
    publishEvents: row?.publishEvents ?? false,
    createPeople: row?.createPeople ?? false,
  };
}

export function updateSettings(patch: Partial<GmailSettings>): GmailSettings {
  const next = { ...getSettings(), ...patch };
  db.insert(settings)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({ target: settings.id, set: next })
    .run();
  return next;
}

export type { RawGmailMessage };
