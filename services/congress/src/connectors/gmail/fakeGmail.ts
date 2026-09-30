import { sql } from "drizzle-orm";
import type { ConnectorContext } from "../contract.js";
import { GoogleApiError } from "../googleApi.js";
import { gmailDb } from "./db/client.js";
import { GMAIL_MODIFY } from "./api.js";
import type { RawGmailMessage } from "./mime.js";
import type { HistoryRecord } from "./api.js";

// Test double for Gmail's REST API and the connector context.

const HOUR = 3_600_000;

export function msg(
  id: string,
  threadId: string,
  opts: { labels?: string[]; from?: string; to?: string; cc?: string; subject?: string; hoursAgo?: number; body?: string } = {}
): RawGmailMessage {
  const headers = [
    { name: "From", value: opts.from ?? "Jane Doe <jane@example.com>" },
    { name: "To", value: opts.to ?? "me@example.com" },
    { name: "Subject", value: opts.subject ?? `Subject ${threadId}` },
    ...(opts.cc ? [{ name: "Cc", value: opts.cc }] : []),
  ];
  return {
    id,
    threadId,
    labelIds: opts.labels ?? ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
    snippet: `snippet ${id}`,
    internalDate: String(Date.now() - (opts.hoursAgo ?? 0.5) * HOUR),
    payload: {
      mimeType: "multipart/alternative",
      headers,
      parts: [{ mimeType: "text/plain", body: { data: Buffer.from(opts.body ?? `body ${id}`).toString("base64url"), size: 10 } }],
    } as RawGmailMessage["payload"],
  };
}

export function fakeGmail() {
  const state = {
    accounts: [{ id: 1, label: "Me", email: "me@example.com", needsReconnect: false, scopes: [GMAIL_MODIFY] }],
    // Threads by id (every account shares them in tests).
    threads: {} as Record<string, RawGmailMessage[]>,
    history: [] as HistoryRecord[],
    historyId: "100",
    historyExpired: false,
    calls: [] as { method: string; url: string; scopes?: string[] }[],
    changes: [] as { kind: string; key: string; deleted: boolean; quiet: boolean }[],
    published: [] as { type: string; payload: Record<string, unknown> }[],
    resolved: [] as { email: string; evidence: string }[],
    found: [] as string[],
    people: {} as Record<string, string>,
    // Record ids by thread key, as bindings would have made them.
    records: {} as Record<string, string>,
  };

  async function fetch(_accountId: number, url: string, init?: RequestInit, scopes?: string[]): Promise<unknown> {
    const method = init?.method ?? "GET";
    const u = new URL(url);
    const path = u.pathname.replace("/gmail/v1/users/me", "");
    state.calls.push({ method, url: path + u.search, scopes });
    if (path === "/profile") return { emailAddress: "me@example.com", historyId: state.historyId };
    if (path === "/threads") {
      const q = u.searchParams.get("q") ?? "";
      const ids = Object.keys(state.threads).filter((id) => !q.startsWith("find:") || state.threads[id]!.some((m) => (m.snippet ?? "").includes(q.slice(5))));
      return { threads: ids.map((id) => ({ id })), resultSizeEstimate: ids.length };
    }
    if (path === "/history") {
      if (state.historyExpired) throw new GoogleApiError(404, "expired");
      const history = state.history;
      state.history = [];
      return { history, historyId: state.historyId };
    }
    const modify = path.match(/^\/threads\/([^/]+)\/modify$/);
    if (modify && method === "POST") {
      for (const m of state.threads[modify[1]!] ?? []) m.labelIds = (m.labelIds ?? []).filter((l) => l !== "UNREAD");
      return {};
    }
    const thread = path.match(/^\/threads\/([^/]+)$/);
    if (thread) {
      const messages = state.threads[decodeURIComponent(thread[1]!)];
      if (!messages) throw new GoogleApiError(404, "not found");
      return { id: thread[1], messages: structuredClone(messages) };
    }
    throw new GoogleApiError(404, `no fake for ${method} ${path}`);
  }

  const ctx: ConnectorContext = {
    name: "gmail",
    google: { accounts: () => state.accounts, fetch },
    people: {
      find: (email) => {
        state.found.push(email);
        return state.people[email] ?? null;
      },
      resolve: (input, evidence) => {
        state.resolved.push({ email: input.email, evidence });
        return evidence === "corresponded" ? `person-${input.email}` : null;
      },
    },
    emitChange: (kind, key, deleted = false, quiet = false) => state.changes.push({ kind, key, deleted, quiet }),
    publish: (type, payload) => state.published.push({ type, payload }),
    records: { idFor: (_kind, key) => state.records[key] ?? null },
    syncNow: () => {},
    reschedule: () => {},
  };
  return { state, ctx };
}

export function resetGmailCache(): void {
  for (const table of ["accounts", "threads", "thread_addresses", "settings"]) gmailDb.run(sql.raw(`delete from ${table}`));
}
