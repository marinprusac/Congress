import { getGoogleAccount, hasGoogleScopes, listGoogleAccounts } from "@congress/chamber-kit";
import type { GoogleAccount } from "@congress/shared-types";
import { threadExhibitId, threadUrl } from "./cache.js";
import {
  MAIL_SCOPES,
  getAttachmentData,
  getLabel,
  getMessageFull,
  getThreadFull,
  getThreadMetadata,
  listLabels,
  listThreadIds,
  mapLimit,
  type GmailLabel,
} from "./gmail/client.js";
import {
  collectParts,
  decodeBase64Url,
  headerValue,
  htmlToText,
  parseAddress,
  stripQuoted,
  type BodyPart,
  type RawGmailMessage,
} from "./gmail/mime.js";
import { getSyncState } from "./sync.js";
import type { MailAccount, MessageDetail, ThreadDetail, ThreadSummary } from "./types.js";

export class MailAccountNotFoundError extends Error {
  constructor(accountId: number) {
    super(`No connected Google account with id ${accountId}`);
    this.name = "MailAccountNotFoundError";
  }
}

export class AttachmentNotFoundError extends Error {
  constructor(partId: string) {
    super(`No attachment with partId ${partId} on that message`);
    this.name = "AttachmentNotFoundError";
  }
}

export function listMailAccounts(): MailAccount[] {
  return listGoogleAccounts().map((account) => {
    const state = getSyncState(account.id);
    return {
      id: account.id,
      label: account.label,
      email: account.email,
      needsReconnect: account.needsReconnect,
      hasAccess: hasGoogleScopes(account, MAIL_SCOPES),
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      lastError: state?.lastError ?? null,
    };
  });
}

function requireAccount(accountId: number): GoogleAccount {
  const account = getGoogleAccount(accountId);
  if (!account) throw new MailAccountNotFoundError(accountId);
  return account;
}

function readableAccounts(accountId?: number): GoogleAccount[] {
  if (accountId !== undefined) return [requireAccount(accountId)];
  return listGoogleAccounts().filter((a) => !a.needsReconnect && hasGoogleScopes(a, MAIL_SCOPES));
}

function labelsOf(messages: RawGmailMessage[]): string[] {
  return [...new Set(messages.flatMap((m) => m.labelIds ?? []))];
}

export function summarizeThread(account: { id: number; email: string }, threadId: string, raw: RawGmailMessage[]): ThreadSummary | null {
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (!first || !last) return null;
  const participants = [
    ...new Set(
      raw.map((m) => {
        const from = parseAddress(headerValue(m.payload?.headers, "From"));
        return from.name ?? from.email ?? "";
      })
    ),
  ].filter(Boolean);
  return {
    accountId: account.id,
    accountEmail: account.email,
    threadId,
    exhibitId: threadExhibitId(account.id, threadId),
    subject: headerValue(first.payload?.headers, "Subject")?.trim() || "(no subject)",
    from: parseAddress(headerValue(last.payload?.headers, "From")),
    participants,
    date: new Date(Number(last.internalDate ?? 0)).toISOString(),
    snippet: last.snippet ?? "",
    messageCount: raw.length,
    unread: raw.some((m) => m.labelIds?.includes("UNREAD")),
    labelIds: labelsOf(raw),
    url: threadUrl(account.id, threadId),
  };
}

// Live Gmail search (full Gmail query syntax) across one or all accounts, newest first.
export async function searchThreads(
  query: string,
  opts: { accountId?: number; maxResults?: number } = {}
): Promise<{ threads: ThreadSummary[]; errors: Array<{ accountId: number; message: string }> }> {
  const maxResults = Math.min(opts.maxResults ?? 20, 50);
  const errors: Array<{ accountId: number; message: string }> = [];
  const perAccount = await Promise.all(
    readableAccounts(opts.accountId).map(async (account) => {
      try {
        const { threads } = await listThreadIds(account.id, { q: query, maxResults });
        const details = await mapLimit(threads, 6, (t) => getThreadMetadata(account.id, t.id));
        return details.flatMap((d) => summarizeThread(account, d.id, d.messages ?? []) ?? []);
      } catch (err) {
        errors.push({ accountId: account.id, message: (err as Error).message });
        return [];
      }
    })
  );
  const threads = perAccount
    .flat()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, maxResults);
  return { threads, errors };
}

async function decodePart(accountId: number, messageId: string, part: BodyPart | null): Promise<string | null> {
  if (!part) return null;
  const data = part.data ?? (part.attachmentId ? await getAttachmentData(accountId, messageId, part.attachmentId) : "");
  return decodeBase64Url(data, part.charset);
}

export async function toMessageDetail(
  accountId: number,
  raw: RawGmailMessage,
  opts: { includeHtml?: boolean; stripQuotes?: boolean; maxBodyChars?: number } = {}
): Promise<MessageDetail> {
  const headers = raw.payload?.headers;
  const parts = collectParts(raw.payload);
  const [plain, html] = await Promise.all([decodePart(accountId, raw.id, parts.text), decodePart(accountId, raw.id, parts.html)]);
  let text = plain?.trim() ? plain : html ? htmlToText(html) : (raw.snippet ?? "");
  if (opts.stripQuotes) text = stripQuoted(text) || text;
  if (opts.maxBodyChars && text.length > opts.maxBodyChars) text = `${text.slice(0, opts.maxBodyChars)}\n… [truncated]`;
  return {
    accountId,
    messageId: raw.id,
    threadId: raw.threadId,
    from: parseAddress(headerValue(headers, "From")),
    to: headerValue(headers, "To") ?? null,
    cc: headerValue(headers, "Cc") ?? null,
    replyTo: headerValue(headers, "Reply-To") ?? null,
    date: new Date(Number(raw.internalDate ?? 0)).toISOString(),
    subject: headerValue(headers, "Subject")?.trim() || "(no subject)",
    labelIds: raw.labelIds ?? [],
    unread: raw.labelIds?.includes("UNREAD") ?? false,
    text,
    html: opts.includeHtml ? html : null,
    attachments: parts.attachments,
  };
}

export function gmailThreadUrl(email: string, threadId: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#all/${threadId}`;
}

export async function getThread(
  accountId: number,
  threadId: string,
  opts: { includeHtml?: boolean; stripQuotes?: boolean; maxBodyChars?: number } = {}
): Promise<ThreadDetail> {
  const account = requireAccount(accountId);
  const raw = await getThreadFull(accountId, threadId);
  const messages = await Promise.all((raw.messages ?? []).map((m) => toMessageDetail(accountId, m, opts)));
  return {
    accountId,
    accountEmail: account.email,
    threadId,
    exhibitId: threadExhibitId(accountId, threadId),
    subject: messages[0]?.subject ?? "(no subject)",
    labelIds: labelsOf(raw.messages ?? []),
    gmailUrl: gmailThreadUrl(account.email, threadId),
    messages,
  };
}

export async function getMessage(
  accountId: number,
  messageId: string,
  opts: { includeHtml?: boolean; maxBodyChars?: number } = {}
): Promise<MessageDetail> {
  requireAccount(accountId);
  return toMessageDetail(accountId, await getMessageFull(accountId, messageId), opts);
}

export async function listAccountLabels(accountId: number): Promise<GmailLabel[]> {
  requireAccount(accountId);
  const labels = await listLabels(accountId);
  return labels.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "system" ? -1 : 1));
}

// Inbox unread counts per account, straight from Gmail.
export async function mailboxSummary(): Promise<
  Array<{ accountId: number; email: string; label: string; inboxUnreadThreads: number | null; inboxThreads: number | null; primaryUnread: number | null; lastSyncedAt: string | null; error: string | null }>
> {
  return Promise.all(
    listMailAccounts().map(async (account) => {
      const base = { accountId: account.id, email: account.email, label: account.label, lastSyncedAt: account.lastSyncedAt };
      if (!account.hasAccess || account.needsReconnect) {
        return { ...base, inboxUnreadThreads: null, inboxThreads: null, primaryUnread: null, error: account.needsReconnect ? "Account needs reconnect" : "Gmail access not granted" };
      }
      try {
        const [inbox, primary] = await Promise.all([
          getLabel(account.id, "INBOX"),
          listThreadIds(account.id, { q: "in:inbox is:unread category:primary", maxResults: 1 }),
        ]);
        return {
          ...base,
          inboxUnreadThreads: inbox.threadsUnread ?? null,
          inboxThreads: inbox.threadsTotal ?? null,
          primaryUnread: primary.resultSizeEstimate ?? null,
          error: null,
        };
      } catch (err) {
        return { ...base, inboxUnreadThreads: null, inboxThreads: null, primaryUnread: null, error: (err as Error).message };
      }
    })
  );
}

const TEXT_LIKE = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript|ics)|message\/rfc822)/i;
const MAX_TEXT_ATTACHMENT_CHARS = 100_000;

export async function getAttachment(
  accountId: number,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  requireAccount(accountId);
  return Buffer.from(await getAttachmentData(accountId, messageId, attachmentId), "base64url");
}

// Text content of a text-like attachment (for the AI); binary files only report metadata.
export async function readAttachmentText(
  accountId: number,
  messageId: string,
  partId: string
): Promise<{ filename: string; mimeType: string; size: number; text: string | null; note?: string }> {
  requireAccount(accountId);
  const raw = await getMessageFull(accountId, messageId);
  const attachment = collectParts(raw.payload).attachments.find((a) => a.partId === partId);
  if (!attachment) throw new AttachmentNotFoundError(partId);
  const meta = { filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size };
  if (!TEXT_LIKE.test(attachment.mimeType)) return { ...meta, text: null, note: "Binary attachment - only its metadata is readable." };
  if (!attachment.attachmentId) return { ...meta, text: "" };
  let text = decodeBase64Url(await getAttachmentData(accountId, messageId, attachment.attachmentId));
  if (/html/i.test(attachment.mimeType)) text = htmlToText(text);
  if (text.length > MAX_TEXT_ATTACHMENT_CHARS) text = `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n… [truncated]`;
  return { ...meta, text };
}
