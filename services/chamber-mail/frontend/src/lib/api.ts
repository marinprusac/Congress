import type { MailAccount, Settings, ThreadDetail, UpdateSettingsRequest } from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json } from "@congress/congress-ui";

const API_BASE = resolveApiBase("mail");

export class MailRequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function jsonOrCode<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  throw new MailRequestError(body.error ?? "request_failed", body.message ?? `Request failed: ${res.status}`);
}

export function fetchAccounts(): Promise<MailAccount[]> {
  return fetch(`${API_BASE}/accounts`).then((res) => json(res));
}

export function syncNow(): Promise<MailAccount[]> {
  return fetch(`${API_BASE}/sync`, { method: "POST" }).then((res) => json(res));
}

export function fetchThread(accountId: number, threadId: string): Promise<ThreadDetail> {
  return fetch(`${API_BASE}/threads/${accountId}/${encodeURIComponent(threadId)}`).then((res) => jsonOrCode(res));
}

export function attachmentUrl(accountId: number, messageId: string, attachmentId: string, filename: string, mimeType: string): string {
  const params = new URLSearchParams({ filename, mimeType });
  return `${API_BASE}/messages/${accountId}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?${params.toString()}`;
}

export function fetchSettings(): Promise<Settings> {
  return fetch(`${API_BASE}/settings`).then((res) => json(res));
}

export function updateSettings(input: UpdateSettingsRequest): Promise<Settings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}
