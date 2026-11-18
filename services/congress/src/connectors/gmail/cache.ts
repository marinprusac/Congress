import { eq } from "drizzle-orm";
import { gmailDb as db } from "./db/client.js";
import { accounts, settings } from "./db/schema.js";
import { categoryOf, headerValue, parseAddress, type RawGmailMessage } from "./mime.js";
import type { RawThread } from "./api.js";

// Nothing about a thread is stored: only each account's history cursor and the
// settings. Threads are read live from Gmail.

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
  key: string;
  accountId: number;
  threadId: string;
  subject: string;
  from: string;
  lastAt: string;
  snippet: string;
  messageCount: number;
  unread: boolean;
  inbox: boolean;
  category: string;
  starred: boolean;
  important: boolean;
  hasAttachments: boolean;
  // Who's on the thread; sentTo: the owner wrote to them (direct contact).
  addresses: { email: string; name: string | null; sentTo: boolean }[];
}

// Pure: a thread's summary, the owner's own addresses left out.
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
    key: threadKey(accountId, raw.id),
    accountId,
    threadId: raw.id,
    subject: headerValue(first.payload?.headers, "Subject")?.trim() || "(no subject)",
    from: from.name ? (from.email ? `${from.name} <${from.email.toLowerCase()}>` : from.name) : (from.email?.toLowerCase() ?? ""),
    lastAt: new Date(Number(last.internalDate ?? 0)).toISOString(),
    snippet: last.snippet ?? "",
    messageCount: msgs.length,
    unread: msgs.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    inbox: labels.includes("INBOX"),
    category: categoryOf(labels),
    starred: labels.includes("STARRED"),
    important: labels.includes("IMPORTANT"),
    hasAttachments: msgs.some((m) => (m.payload?.mimeType ?? "").toLowerCase() === "multipart/mixed"),
    addresses: [...addresses.values()],
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

// Everything tied to an account the owner disconnected.
export function forgetAccount(accountId: number): void {
  db.delete(accounts).where(eq(accounts.accountId, accountId)).run();
}

export type GmailSettings = { includeAllCategories: boolean; publishEvents: boolean };

export function getSettings(): GmailSettings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  return {
    includeAllCategories: row?.includeAllCategories ?? false,
    publishEvents: row?.publishEvents ?? false,
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
