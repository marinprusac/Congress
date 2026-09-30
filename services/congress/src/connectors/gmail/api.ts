import type { ConnectorContext } from "../contract.js";
import type { RawGmailMessage } from "./mime.js";

export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
// Modify covers reading plus marking read; nothing is ever sent or deleted.
export const MAIL_SCOPES = [GMAIL_MODIFY];

export const canRead = (scopes: string[]) => scopes.includes(GMAIL_READONLY) || scopes.includes(GMAIL_MODIFY);
export const canModify = (scopes: string[]) => scopes.includes(GMAIL_MODIFY);

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Older grants still read with gmail.readonly.
function readScopes(ctx: ConnectorContext, accountId: number): string[] {
  const account = ctx.google.accounts().find((a) => a.id === accountId);
  return account && canModify(account.scopes) ? [GMAIL_MODIFY] : [GMAIL_READONLY];
}

export function gmail<T>(ctx: ConnectorContext, accountId: number, path: string, write?: { body: unknown }): Promise<T> {
  const init: RequestInit = write
    ? { method: "POST", body: JSON.stringify(write.body), signal: AbortSignal.timeout(30_000) }
    : { signal: AbortSignal.timeout(30_000) };
  return ctx.google.fetch(accountId, `${BASE}${path}`, init, write ? [GMAIL_MODIFY] : readScopes(ctx, accountId)) as Promise<T>;
}

const METADATA = ["From", "To", "Cc", "Subject", "Date"].map((h) => `metadataHeaders=${h}`).join("&");

export type RawThread = { id: string; historyId?: string; messages?: RawGmailMessage[] };

export const getProfile = (ctx: ConnectorContext, accountId: number) =>
  gmail<{ emailAddress: string; historyId: string }>(ctx, accountId, "/profile");

export async function listThreadIds(
  ctx: ConnectorContext,
  accountId: number,
  opts: { q?: string; maxResults: number; pageToken?: string }
): Promise<{ threads: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams({ maxResults: String(opts.maxResults) });
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const body = await gmail<{ threads?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(ctx, accountId, `/threads?${params}`);
  return { threads: body.threads ?? [], nextPageToken: body.nextPageToken, resultSizeEstimate: body.resultSizeEstimate };
}

export const getThreadMetadata = (ctx: ConnectorContext, accountId: number, threadId: string) =>
  gmail<RawThread>(ctx, accountId, `/threads/${encodeURIComponent(threadId)}?format=metadata&${METADATA}`);

export const getThreadFull = (ctx: ConnectorContext, accountId: number, threadId: string) =>
  gmail<RawThread>(ctx, accountId, `/threads/${encodeURIComponent(threadId)}?format=full`);

export const getMessageFull = (ctx: ConnectorContext, accountId: number, messageId: string) =>
  gmail<RawGmailMessage>(ctx, accountId, `/messages/${encodeURIComponent(messageId)}?format=full`);

export const markThreadReadInGmail = (ctx: ConnectorContext, accountId: number, threadId: string) =>
  gmail<unknown>(ctx, accountId, `/threads/${encodeURIComponent(threadId)}/modify`, { body: { removeLabelIds: ["UNREAD"] } });

export async function getAttachmentData(ctx: ConnectorContext, accountId: number, messageId: string, attachmentId: string): Promise<string> {
  const body = await gmail<{ data?: string }>(ctx, accountId, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return body.data ?? "";
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  threadsTotal?: number;
  threadsUnread?: number;
}

export async function listLabels(ctx: ConnectorContext, accountId: number): Promise<GmailLabel[]> {
  return (await gmail<{ labels?: GmailLabel[] }>(ctx, accountId, "/labels")).labels ?? [];
}

export const getLabel = (ctx: ConnectorContext, accountId: number, labelId: string) =>
  gmail<GmailLabel>(ctx, accountId, `/labels/${encodeURIComponent(labelId)}`);

type HistoryMessage = { message: { id: string; threadId: string; labelIds?: string[] } };
export interface HistoryRecord {
  messagesAdded?: HistoryMessage[];
  messagesDeleted?: HistoryMessage[];
  labelsAdded?: HistoryMessage[];
  labelsRemoved?: HistoryMessage[];
}

export async function listHistory(
  ctx: ConnectorContext,
  accountId: number,
  startHistoryId: string,
  pageToken?: string
): Promise<{ history: HistoryRecord[]; historyId: string; nextPageToken?: string }> {
  const params = new URLSearchParams({ startHistoryId, maxResults: "500" });
  if (pageToken) params.set("pageToken", pageToken);
  const body = await gmail<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(ctx, accountId, `/history?${params}`);
  return { history: body.history ?? [], historyId: body.historyId, nextPageToken: body.nextPageToken };
}

// Bounded parallelism for per-thread fetches.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
