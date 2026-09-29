import { getGoogleAccount, googleAccessToken } from "@congress/chamber-kit";
import type { GoogleAccount } from "@congress/shared-types";
import type { RawGmailMessage } from "./mime.js";

export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
// What Mail asks for: modify covers reading plus marking read (never sending or deleting).
export const MAIL_SCOPES = [GMAIL_MODIFY];

// Accounts granted before read-sync still read with gmail.readonly.
export function canRead(account: GoogleAccount): boolean {
  return account.scopes.includes(GMAIL_READONLY) || account.scopes.includes(GMAIL_MODIFY);
}

export function canModify(account: GoogleAccount): boolean {
  return account.scopes.includes(GMAIL_MODIFY);
}

function readScopes(accountId: number): string[] {
  const account = getGoogleAccount(accountId);
  return account && canModify(account) ? [GMAIL_MODIFY] : [GMAIL_READONLY];
}

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    let detail = body.slice(0, 200);
    try {
      detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message?.split(". ")[0] ?? detail;
    } catch {
      // not JSON - keep the raw text
    }
    super(`Gmail API error ${status}: ${detail}`);
    this.name = "GmailApiError";
    this.status = status;
  }
}

export async function gmailFetch<T>(accountId: number, path: string, write?: { method: "POST"; body: unknown }): Promise<T> {
  const token = await googleAccessToken(accountId, write ? [GMAIL_MODIFY] : readScopes(accountId));
  const res = await fetch(`${BASE}${path}`, {
    method: write?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(write ? { "Content-Type": "application/json" } : {}) },
    body: write ? JSON.stringify(write.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new GmailApiError(res.status, await res.text());
  return (await res.json()) as T;
}

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date"];

function metadataQuery(): string {
  return METADATA_HEADERS.map((h) => `metadataHeaders=${h}`).join("&");
}

export function getProfile(accountId: number) {
  return gmailFetch<{ emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string }>(accountId, "/profile");
}

export async function listMessageIds(
  accountId: number,
  opts: { q?: string; labelIds?: string[]; maxResults: number; pageToken?: string }
): Promise<{ ids: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams({ maxResults: String(opts.maxResults) });
  if (opts.q) params.set("q", opts.q);
  for (const label of opts.labelIds ?? []) params.append("labelIds", label);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const body = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(
    accountId,
    `/messages?${params.toString()}`
  );
  return { ids: body.messages ?? [], nextPageToken: body.nextPageToken, resultSizeEstimate: body.resultSizeEstimate };
}

export async function listThreadIds(
  accountId: number,
  opts: { q?: string; labelIds?: string[]; maxResults: number; pageToken?: string }
): Promise<{ threads: Array<{ id: string; snippet?: string }>; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams({ maxResults: String(opts.maxResults) });
  if (opts.q) params.set("q", opts.q);
  for (const label of opts.labelIds ?? []) params.append("labelIds", label);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const body = await gmailFetch<{ threads?: Array<{ id: string; snippet?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(
    accountId,
    `/threads?${params.toString()}`
  );
  return { threads: body.threads ?? [], nextPageToken: body.nextPageToken, resultSizeEstimate: body.resultSizeEstimate };
}

export function getMessageMetadata(accountId: number, messageId: string): Promise<RawGmailMessage> {
  return gmailFetch<RawGmailMessage>(accountId, `/messages/${encodeURIComponent(messageId)}?format=metadata&${metadataQuery()}`);
}

export function getMessageFull(accountId: number, messageId: string): Promise<RawGmailMessage> {
  return gmailFetch<RawGmailMessage>(accountId, `/messages/${encodeURIComponent(messageId)}?format=full`);
}

export function getThreadMetadata(accountId: number, threadId: string): Promise<{ id: string; messages?: RawGmailMessage[] }> {
  return gmailFetch(accountId, `/threads/${encodeURIComponent(threadId)}?format=metadata&${metadataQuery()}`);
}

export function getThreadFull(accountId: number, threadId: string): Promise<{ id: string; messages?: RawGmailMessage[] }> {
  return gmailFetch(accountId, `/threads/${encodeURIComponent(threadId)}?format=full`);
}

export function markThreadReadInGmail(accountId: number, threadId: string): Promise<unknown> {
  return gmailFetch(accountId, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: { removeLabelIds: ["UNREAD"] },
  });
}

export async function getAttachmentData(accountId: number, messageId: string, attachmentId: string): Promise<string> {
  const body = await gmailFetch<{ data?: string }>(
    accountId,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
  return body.data ?? "";
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

export async function listLabels(accountId: number): Promise<GmailLabel[]> {
  const body = await gmailFetch<{ labels?: GmailLabel[] }>(accountId, "/labels");
  return body.labels ?? [];
}

export function getLabel(accountId: number, labelId: string): Promise<GmailLabel> {
  return gmailFetch<GmailLabel>(accountId, `/labels/${encodeURIComponent(labelId)}`);
}

export interface HistoryRecord {
  id: string;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
  labelsRemoved?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
}

export async function listHistory(
  accountId: number,
  startHistoryId: string,
  pageToken?: string
): Promise<{ history: HistoryRecord[]; historyId: string; nextPageToken?: string }> {
  const params = new URLSearchParams({ startHistoryId, maxResults: "500" });
  if (pageToken) params.set("pageToken", pageToken);
  const body = await gmailFetch<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(accountId, `/history?${params.toString()}`);
  return { history: body.history ?? [], historyId: body.historyId, nextPageToken: body.nextPageToken };
}

// Bounded parallelism for per-message fetches.
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
