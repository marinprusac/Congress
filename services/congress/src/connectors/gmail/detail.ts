import type { ConnectorContext, SourceRecord } from "../contract.js";
import { canRead, getAttachmentData, getLabel, getMessageFull, getThreadFull, getThreadMetadata, listThreadIds, mapLimit } from "./api.js";
import { getAccountState, gmailThreadUrl, liveMessages, parseThreadKey, summarize, threadKey, toSourceRecord } from "./cache.js";
import { collectParts, decodeBase64Url, headerValue, htmlToText, parseAddress, stripQuoted, type AttachmentInfo, type BodyPart, type RawGmailMessage } from "./mime.js";

export interface MessageDetail {
  messageId: string;
  from: { name: string | null; email: string | null };
  to: string | null;
  cc: string | null;
  date: string;
  unread: boolean;
  text: string;
  html: string | null;
  attachments: (AttachmentInfo & { url: string | null })[];
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

export const attachmentUrl = (accountId: number, messageId: string, a: AttachmentInfo) =>
  a.attachmentId
    ? `/congress/connectors/gmail/attachments/${accountId}/${encodeURIComponent(messageId)}/${encodeURIComponent(a.attachmentId)}?${new URLSearchParams({ filename: a.filename, type: a.mimeType })}`
    : null;

async function toMessage(ctx: ConnectorContext, accountId: number, raw: RawGmailMessage, opts: { html: boolean; stripQuotes: boolean; maxChars?: number }): Promise<MessageDetail> {
  const headers = raw.payload?.headers;
  const parts = collectParts(raw.payload);
  const [plain, html] = await Promise.all([decodePart(ctx, accountId, raw.id, parts.text), decodePart(ctx, accountId, raw.id, parts.html)]);
  let text = plain?.trim() ? plain : html ? htmlToText(html) : (raw.snippet ?? "");
  if (opts.stripQuotes) text = stripQuoted(text) || text;
  if (opts.maxChars && text.length > opts.maxChars) text = `${text.slice(0, opts.maxChars)}\n… [truncated]`;
  return {
    messageId: raw.id,
    from: parseAddress(headerValue(headers, "From")),
    to: headerValue(headers, "To") ?? null,
    cc: headerValue(headers, "Cc") ?? null,
    date: new Date(Number(raw.internalDate ?? 0)).toISOString(),
    unread: raw.labelIds?.includes("UNREAD") ?? false,
    text,
    html: opts.html ? html : null,
    attachments: parts.attachments.map((a) => ({ ...a, url: attachmentUrl(accountId, raw.id, a) })),
  };
}

// The whole thread, live. For the AI (opts.ai): quotes stripped, no HTML, capped.
export async function threadDetail(ctx: ConnectorContext, key: string, opts: Record<string, string>): Promise<ThreadDetail> {
  const parsed = parseThreadKey(key);
  if (!parsed) throw new Error(`Not a Gmail thread: ${key}`);
  const a = account(ctx, parsed.accountId);
  const ai = opts.ai === "1";
  const raw = await getThreadFull(ctx, parsed.accountId, parsed.threadId);
  const msgs = liveMessages(raw);
  const messages = await Promise.all(
    msgs.map((m) => toMessage(ctx, parsed.accountId, m, { html: !ai, stripQuotes: ai || opts.stripQuotes === "1", maxChars: ai ? 20_000 : undefined }))
  );
  return {
    key,
    accountEmail: a.email,
    subject: headerValue(msgs[0]?.payload?.headers, "Subject")?.trim() || "(no subject)",
    gmailUrl: gmailThreadUrl(a.email, parsed.threadId),
    messages,
  };
}

const readable = (ctx: ConnectorContext) => ctx.google.accounts().filter((a) => !a.needsReconnect && canRead(a.scopes));
const own = (ctx: ConnectorContext) => new Set(ctx.google.accounts().map((a) => a.email.toLowerCase()));

// Live Gmail search (its own query syntax) over every account; nothing is cached.
export async function searchThreads(ctx: ConnectorContext, query: string, limit: number): Promise<SourceRecord[]> {
  const per = await Promise.all(
    readable(ctx).map(async (a) => {
      try {
        const { threads } = await listThreadIds(ctx, a.id, { q: query, maxResults: limit });
        const raws = await mapLimit(threads, 6, (t) => getThreadMetadata(ctx, a.id, t.id));
        return raws.flatMap((raw) => {
          const s = summarize(a.id, raw, own(ctx));
          return s ? [toSourceRecord(s.row)] : [];
        });
      } catch (err) {
        console.warn(`[gmail] search failed for ${a.email}: ${(err as Error).message}`);
        return [];
      }
    })
  );
  return per
    .flat()
    .sort((x, y) => String(y.values.lastAt).localeCompare(String(x.values.lastAt)))
    .slice(0, limit);
}

export async function attachmentBytes(ctx: ConnectorContext, accountId: number, messageId: string, attachmentId: string): Promise<Buffer> {
  account(ctx, accountId);
  return Buffer.from(await getAttachmentData(ctx, accountId, messageId, attachmentId), "base64url");
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

export { threadKey };
