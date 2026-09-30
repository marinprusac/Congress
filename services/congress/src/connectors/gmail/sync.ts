import { isNull } from "drizzle-orm";
import type { ConnectorContext, SyncResult } from "../contract.js";
import { GoogleApiError } from "../googleApi.js";
import { gmailDb as db } from "./db/client.js";
import { threadAddresses } from "./db/schema.js";
import { canModify, canRead, getProfile, getThreadMetadata, listHistory, listThreadIds, mapLimit, type RawThread } from "./api.js";
import {
  getAccountState,
  getSettings,
  getThreadRow,
  linkPeople,
  liveMessages,
  rememberAccounts,
  removeThread,
  setAccountState,
  summarize,
  threadKey,
  writeThread,
} from "./cache.js";
import { categoryOf, displayFrom, headerValue, parseAddress } from "./mime.js";

const BACKFILL_QUERY = "newer_than:30d -in:spam -in:trash -in:chats";
const BACKFILL_MAX = 500;
// Older mail surfacing through history (e.g. moved back to the inbox) isn't "received".
const RECEIVED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Account = { id: number; email: string; label: string };

const ownAddresses = (ctx: ConnectorContext) => new Set(ctx.google.accounts().map((a) => a.email.toLowerCase()));

// Re-reads one thread from Gmail into the cache and announces the change.
// announce: publish mail.received for messages not seen before.
export async function refreshThread(ctx: ConnectorContext, account: Account, threadId: string, opts: { quiet?: boolean; announce?: boolean } = {}): Promise<string | null> {
  const key = threadKey(account.id, threadId);
  let raw: RawThread;
  try {
    raw = await getThreadMetadata(ctx, account.id, threadId);
  } catch (err) {
    if (!(err instanceof GoogleApiError && err.status === 404)) throw err;
    raw = { id: threadId, messages: [] };
  }
  const summary = summarize(account.id, raw, ownAddresses(ctx));
  if (!summary) {
    if (removeThread(key)) ctx.emitChange("thread", key, true);
    return null;
  }
  const prev = getThreadRow(key);
  const seen = new Set(prev ? (JSON.parse(prev.messageIds) as string[]) : []);
  writeThread(summary);
  linkPeople(ctx, key);
  ctx.emitChange("thread", key, false, opts.quiet);
  if (opts.announce) publishReceived(ctx, account, raw, seen);
  return key;
}

function publishReceived(ctx: ConnectorContext, account: Account, raw: RawThread, seen: Set<string>): void {
  const { publishEvents, includeAllCategories } = getSettings();
  if (!publishEvents) return;
  const now = Date.now();
  const recordId = ctx.records.idFor("thread", threadKey(account.id, raw.id));
  for (const m of liveMessages(raw)) {
    const labels = m.labelIds ?? [];
    if (seen.has(m.id) || !labels.includes("INBOX") || labels.includes("SENT")) continue;
    if (now - Number(m.internalDate ?? 0) > RECEIVED_MAX_AGE_MS) continue;
    const category = categoryOf(labels);
    if (!includeAllCategories && category !== "primary") continue;
    const from = parseAddress(headerValue(m.payload?.headers, "From"));
    ctx.publish("mail.received", {
      accountId: account.id,
      account: account.email,
      messageId: m.id,
      threadId: raw.id,
      // The record's id and page once bound; else the Mail Chamber's (aliases, redirects).
      exhibitId: recordId ?? `thread-${account.id}:${raw.id}`,
      from: displayFrom(from),
      fromEmail: from.email ?? "",
      subject: headerValue(m.payload?.headers, "Subject")?.trim() || "(no subject)",
      snippet: m.snippet ?? "",
      category,
      url: recordId ? `/e/${recordId}` : `/mail/t/${account.id}/${raw.id}`,
    });
  }
}

// The last 30 days, quietly (no events for mail that was already there).
async function backfill(ctx: ConnectorContext, account: Account): Promise<void> {
  const { historyId } = await getProfile(ctx, account.id);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listThreadIds(ctx, account.id, { q: BACKFILL_QUERY, maxResults: 100, pageToken });
    ids.push(...page.threads.map((t) => t.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < BACKFILL_MAX);
  await mapLimit(ids.slice(0, BACKFILL_MAX), 6, (id) => refreshThread(ctx, account, id, { quiet: true }));
  setAccountState(account.id, { historyId });
}

// Applies Gmail's history since the cursor: refreshes every touched thread
// we keep, and any thread that got new mail.
export async function applyHistory(ctx: ConnectorContext, account: Account, startHistoryId: string): Promise<void> {
  const touched = new Set<string>();
  const grew = new Set<string>();
  let latest = startHistoryId;
  let pageToken: string | undefined;
  do {
    const page = await listHistory(ctx, account.id, startHistoryId, pageToken);
    for (const r of page.history) {
      for (const { message } of r.messagesAdded ?? []) {
        touched.add(message.threadId);
        if (!(message.labelIds ?? []).some((l) => ["DRAFT", "SPAM", "TRASH"].includes(l))) grew.add(message.threadId);
      }
      for (const { message } of [...(r.labelsAdded ?? []), ...(r.labelsRemoved ?? []), ...(r.messagesDeleted ?? [])]) touched.add(message.threadId);
    }
    latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  const todo = [...touched].filter((id) => grew.has(id) || getThreadRow(threadKey(account.id, id)));
  await mapLimit(todo, 6, (id) => refreshThread(ctx, account, id, { announce: true }));
  setAccountState(account.id, { historyId: latest });
}

export async function syncAccount(ctx: ConnectorContext, account: Account): Promise<void> {
  const state = getAccountState(account.id);
  if (!state?.historyId) return backfill(ctx, account);
  try {
    await applyHistory(ctx, account, state.historyId);
  } catch (err) {
    // 404: the cursor is too old; start over.
    if (err instanceof GoogleApiError && err.status === 404) await backfill(ctx, account);
    else throw err;
  }
}

// Addresses not yet linked get another look (People made since, or creation now allowed).
function relinkAll(ctx: ConnectorContext): void {
  const keys = new Set(db.selectDistinct({ key: threadAddresses.threadKey }).from(threadAddresses).where(isNull(threadAddresses.personId)).all().map((r) => r.key));
  for (const key of keys) if (linkPeople(ctx, key)) ctx.emitChange("thread", key);
}

let running: Promise<SyncResult> | null = null;

// Every account that granted Gmail access; one pass at a time.
export function syncAll(ctx: ConnectorContext): Promise<SyncResult> {
  running ??= (async () => {
    const all = ctx.google.accounts();
    rememberAccounts(all.map((a) => ({ id: a.id, email: a.email, label: a.label, modify: canModify(a.scopes) })));
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
    relinkAll(ctx);
    return { changed, error: errors.length ? errors.join("; ") : null };
  })().finally(() => {
    running = null;
  });
  return running;
}
