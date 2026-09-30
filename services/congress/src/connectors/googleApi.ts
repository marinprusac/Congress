import { getAccessToken } from "./google/accounts.js";

export class GoogleApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Google said ${status}: ${googleMessage(body)}`);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

// Google's own one-line message from its JSON error body, first sentence only.
export function googleMessage(body: string): string {
  let text = body;
  try {
    text = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
  } catch {
    // not JSON
  }
  const first = text.split(/(?<=\.)\s/)[0]!.trim();
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

// An authorized Google API call; scope and reconnect errors come from getAccessToken.
export async function googleApiFetch(accountId: number, scopes: string[], url: string, init?: RequestInit): Promise<unknown> {
  const token = await getAccessToken(accountId, scopes);
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text());
  if (res.status === 204) return undefined;
  return res.json();
}
