import type { ConnectorContext, SyncResult } from "../contract.js";
import { GoogleApiError } from "../googleApi.js";
import { canRead, getProfile, getThreadMetadata, listHistory, mapLimit } from "./api.js";
import { getAccountState, getSettings, gmailThreadUrl, liveMessages, setAccountState } from "./cache.js";
import { categoryOf, displayFrom, headerValue, parseAddress } from "./mime.js";

// Older mail surfacing through history (e.g. moved back to the inbox) isn't "received".
const RECEIVED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Account = { id: number; email: string; label: string };

// Publishes mail.received for the given newly added messages of a thread.
async function announce(ctx: ConnectorContext, account: Account, threadId: string, added: Set<string>): Promise<void> {
  const { includeAllCategories } = getSettings();
  let raw;
  try {
    raw = await getThreadMetadata(ctx, account.id, threadId);
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return;
    throw err;
  }
  const now = Date.now();
  for (const m of liveMessages(raw)) {
    const labels = m.labelIds ?? [];
    if (!added.has(m.id) || !labels.includes("INBOX") || labels.includes("SENT")) continue;
    if (now - Number(m.internalDate ?? 0) > RECEIVED_MAX_AGE_MS) continue;
    const category = categoryOf(labels);
    if (!includeAllCategories && category !== "primary") continue;
    const from = parseAddress(headerValue(m.payload?.headers, "From"));
    ctx.publish("mail.received", {
      accountId: account.id,
      account: account.email,
      messageId: m.id,
      threadId,
      from: displayFrom(from),
      fromEmail: from.email ?? "",
      subject: headerValue(m.payload?.headers, "Subject")?.trim() || "(no subject)",
      snippet: m.snippet ?? "",
      category,
      url: gmailThreadUrl(account.email, threadId),
    });
  }
}

// Applies Gmail's history since the cursor: announces new inbox mail. Nothing
// is stored but the cursor.
export async function applyHistory(ctx: ConnectorContext, account: Account, startHistoryId: string): Promise<void> {
  const added = new Map<string, Set<string>>();
  let latest = startHistoryId;
  let pageToken: string | undefined;
  do {
    const page = await listHistory(ctx, account.id, startHistoryId, pageToken);
    for (const r of page.history) {
      for (const { message } of r.messagesAdded ?? []) {
        if ((message.labelIds ?? []).some((l) => ["DRAFT", "SPAM", "TRASH"].includes(l))) continue;
        const ids = added.get(message.threadId) ?? new Set<string>();
        ids.add(message.id);
        added.set(message.threadId, ids);
      }
    }
    latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (getSettings().publishEvents) await mapLimit([...added], 6, ([threadId, ids]) => announce(ctx, account, threadId, ids));
  setAccountState(account.id, { historyId: latest });
}

// The first pass only takes the cursor: mail that was already there isn't news.
async function startCursor(ctx: ConnectorContext, account: Account): Promise<void> {
  setAccountState(account.id, { historyId: (await getProfile(ctx, account.id)).historyId });
}

export async function syncAccount(ctx: ConnectorContext, account: Account): Promise<void> {
  const state = getAccountState(account.id);
  if (!state?.historyId) return startCursor(ctx, account);
  try {
    await applyHistory(ctx, account, state.historyId);
  } catch (err) {
    // 404: the cursor is too old; start over.
    if (err instanceof GoogleApiError && err.status === 404) await startCursor(ctx, account);
    else throw err;
  }
}

let running: Promise<SyncResult> | null = null;

// Every account that granted Gmail access; one pass at a time.
export function syncAll(ctx: ConnectorContext): Promise<SyncResult> {
  running ??= (async () => {
    const all = ctx.google.accounts();
    const errors: string[] = [];
    let changed = 0;
    for (const a of all) {
      if (a.needsReconnect || !canRead(a.scopes)) continue;
      try {
        await syncAccount(ctx, a);
        setAccountState(a.id, { lastSyncedAt: new Date(), lastError: null });
        changed++;
      } catch (err) {
        const message = (err as Error).message;
        setAccountState(a.id, { lastError: message });
        errors.push(`${a.email}: ${message}`);
      }
    }
    return { changed, error: errors.length ? errors.join("; ") : null };
  })().finally(() => {
    running = null;
  });
  return running;
}
