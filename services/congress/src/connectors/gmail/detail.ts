import type { ConnectorContext } from "../contract.js";
import { canRead, getAttachmentData, getLabel, getMessageFull, getThreadFull, getThreadMetadata, listThreadIds, mapLimit } from "./api.js";
import { getAccountState, gmailThreadUrl, liveMessages, parseThreadKey, summarize, type Summary } from "./cache.js";
import { collectParts, decodeBase64Url, headerValue, htmlToText, parseAddress, stripQuoted, type AttachmentInfo, type BodyPart, type RawGmailMessage } from "./mime.js";

export interface MessageDetail {
  messageId: string;
  from: { name: string | null; email: string | null };
  to: string | null;
  cc: string | null;
  date: string;
  unread: boolean;
  text: string;
  attachments: AttachmentInfo[];
}

export interface ThreadDetail {
  key: string;
  accountEmail: string;
  subject: string;
  gmailUrl: string;
  messages: MessageDetail[];
}

function account(ctx: ConnectorContext, accountId: number) {
  const a = ctx.google.accounts().find((x) => x.id === accountId);
  if (!a) throw new Error(`No connected Google account ${accountId}`);
  return a;
}

async function decodePart(ctx: ConnectorContext, accountId: number, messageId: string, part: BodyPart | null): Promise<string | null> {
  if (!part) return null;
  const data = part.data ?? (part.attachmentId ? await getAttachmentData(ctx, accountId, messageId, part.attachmentId) : "");
  return decodeBase64Url(data, part.charset);
}

async function toMessage(ctx: ConnectorContext, accountId: number, raw: RawGmailMessage): Promise<MessageDetail> {
  const headers = raw.payload?.headers;
  const parts = collectParts(raw.payload);
  const [plain, html] = await Promise.all([decodePart(ctx, accountId, raw.id, parts.text), decodePart(ctx, accountId, raw.id, parts.html)]);
  let text = plain?.trim() ? plain : html ? htmlToText(html) : (raw.snippet ?? "");
  text = stripQuoted(text) || text;
  if (text.length > 20_000) text = `${text.slice(0, 20_000)}\n… [truncated]`;
  return {
    messageId: raw.id,
    from: parseAddress(headerValue(headers, "From")),
    to: headerValue(headers, "To") ?? null,
    cc: headerValue(headers, "Cc") ?? null,
    date: new Date(Number(raw.internalDate ?? 0)).toISOString(),
    unread: raw.labelIds?.includes("UNREAD") ?? false,
    text,
    attachments: parts.attachments,
  };
}

// The whole thread, live, for the AI: quotes stripped, no HTML, capped.
export async function threadDetail(ctx: ConnectorContext, key: string): Promise<ThreadDetail> {
  const parsed = parseThreadKey(key);
  if (!parsed) throw new Error(`Not a Gmail thread: ${key}`);
  const a = account(ctx, parsed.accountId);
  const msgs = liveMessages(await getThreadFull(ctx, parsed.accountId, parsed.threadId));
  return {
    key,
    accountEmail: a.email,
    subject: headerValue(msgs[0]?.payload?.headers, "Subject")?.trim() || "(no subject)",
    gmailUrl: gmailThreadUrl(a.email, parsed.threadId),
    messages: await Promise.all(msgs.map((m) => toMessage(ctx, parsed.accountId, m))),
  };
}

const readable = (ctx: ConnectorContext) => ctx.google.accounts().filter((a) => !a.needsReconnect && canRead(a.scopes));
const own = (ctx: ConnectorContext) => new Set(ctx.google.accounts().map((a) => a.email.toLowerCase()));

export type ThreadHit = Omit<Summary, "accountId" | "threadId" | "addresses"> & { account: string; people: string[] };

// Live Gmail search (its own query syntax) over every account; nothing is stored.
export async function searchThreads(ctx: ConnectorContext, query: string, limit: number): Promise<ThreadHit[]> {
  const per = await Promise.all(
    readable(ctx).map(async (a) => {
      try {
        const { threads } = await listThreadIds(ctx, a.id, { q: query, maxResults: limit });
        const raws = await mapLimit(threads, 6, (t) => getThreadMetadata(ctx, a.id, t.id));
        return raws.flatMap((raw) => {
          const s = summarize(a.id, raw, own(ctx));
          if (!s) return [];
          const { accountId: _a, threadId: _t, addresses, ...rest } = s;
          return [{ ...rest, account: a.email, people: addresses.map((p) => `${p.name ? `${p.name} <${p.email}>` : p.email}${p.sentTo ? " (you wrote to them)" : ""}`) }];
        });
      } catch (err) {
        console.warn(`[gmail] search failed for ${a.email}: ${(err as Error).message}`);
        return [];
      }
    })
  );
  return per
    .flat()
    .sort((x, y) => y.lastAt.localeCompare(x.lastAt))
    .slice(0, limit);
}

const TEXT_LIKE = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript|ics)|message\/rfc822)/i;

// A text-like attachment's content for the AI; binary files report metadata only.
export async function readAttachmentText(ctx: ConnectorContext, accountId: number, messageId: string, partId: string) {
  account(ctx, accountId);
  const raw = await getMessageFull(ctx, accountId, messageId);
  const a = collectParts(raw.payload).attachments.find((x) => x.partId === partId);
  if (!a) throw new Error(`No attachment ${partId} on that message`);
  const meta = { filename: a.filename, mimeType: a.mimeType, size: a.size };
  if (!TEXT_LIKE.test(a.mimeType)) return { ...meta, text: null, note: "Binary attachment - only its metadata is readable." };
  if (!a.attachmentId) return { ...meta, text: "" };
  let text = decodeBase64Url(await getAttachmentData(ctx, accountId, messageId, a.attachmentId));
  if (/html/i.test(a.mimeType)) text = htmlToText(text);
  return { ...meta, text: text.length > 100_000 ? `${text.slice(0, 100_000)}\n… [truncated]` : text };
}

// Inbox counts per account, straight from Gmail.
export async function mailboxSummary(ctx: ConnectorContext) {
  return Promise.all(
    ctx.google.accounts().map(async (a) => {
      const base = { accountId: a.id, email: a.email, lastSyncedAt: getAccountState(a.id)?.lastSyncedAt?.toISOString() ?? null };
      if (a.needsReconnect || !canRead(a.scopes)) return { ...base, error: a.needsReconnect ? "Account needs reconnect" : "Gmail access not granted" };
      try {
        const [inbox, primary] = await Promise.all([getLabel(ctx, a.id, "INBOX"), listThreadIds(ctx, a.id, { q: "in:inbox is:unread category:primary", maxResults: 1 })]);
        return { ...base, inboxUnreadThreads: inbox.threadsUnread ?? null, inboxThreads: inbox.threadsTotal ?? null, primaryUnread: primary.resultSizeEstimate ?? null };
      } catch (err) {
        return { ...base, error: (err as Error).message };
      }
    })
  );
}

