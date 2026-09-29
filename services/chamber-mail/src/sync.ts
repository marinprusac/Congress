import { eq } from "drizzle-orm";
import {
  GoogleAccountNeedsReconnectError,
  GoogleScopeMissingError,
  hasGoogleScopes,
  listGoogleAccounts,
} from "@congress/chamber-kit";
import { db } from "./db/client.js";
import { syncState } from "./db/schema.js";
import {
  deleteCachedMessage,
  getCachedMessage,
  pruneCachedMessages,
  threadExhibitId,
  threadUrl,
  toCacheRow,
  toSummary,
  upsertCachedMessage,
} from "./cache.js";
import { GmailApiError, MAIL_SCOPES, getMessageMetadata, getProfile, listHistory, listMessageIds, mapLimit } from "./gmail/client.js";
import { categoryOf, displayFrom } from "./gmail/mime.js";
import { publishEvent } from "./events.js";
import { getSettings } from "./settings.js";

const BACKFILL_QUERY = "newer_than:30d -in:spam -in:trash -in:chats";
const BACKFILL_MAX = 500;
const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
// Older mail surfacing through history (e.g. moved back to the inbox) isn't "received".
const RECEIVED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

function setState(accountId: number, values: Partial<typeof syncState.$inferInsert>): void {
  db.insert(syncState)
    .values({ accountId, ...values })
    .onConflictDoUpdate({ target: syncState.accountId, set: values })
    .run();
}

export function getSyncState(accountId: number) {
  return db.select().from(syncState).where(eq(syncState.accountId, accountId)).get();
}

async function backfill(accountId: number): Promise<void> {
  // Cursor first, so nothing arriving mid-backfill is missed.
  const { historyId } = await getProfile(accountId);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIds(accountId, { q: BACKFILL_QUERY, maxResults: 100, pageToken });
    ids.push(...page.ids.map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < BACKFILL_MAX);

  await mapLimit(ids.slice(0, BACKFILL_MAX), 8, async (id) => {
    try {
      upsertCachedMessage(toCacheRow(await getMessageMetadata(accountId, id), accountId));
    } catch (err) {
      if (!(err instanceof GmailApiError && err.status === 404)) throw err;
    }
  });
  setState(accountId, { historyId });
}

const DROP_LABELS = ["SPAM", "TRASH"];

// Applies Gmail's history since the stored cursor; returns newly received message ids.
export async function applyHistory(accountId: number, startHistoryId: string): Promise<string[]> {
  const added = new Map<string, string[]>();
  const relabeled = new Map<string, string[]>();
  const deleted = new Set<string>();
  let latestHistoryId = startHistoryId;
  let pageToken: string | undefined;
  do {
    const page = await listHistory(accountId, startHistoryId, pageToken);
    for (const record of page.history) {
      for (const { message } of record.messagesAdded ?? []) added.set(message.id, message.labelIds ?? []);
      for (const { message } of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
        relabeled.set(message.id, message.labelIds ?? []);
      }
      for (const { message } of record.messagesDeleted ?? []) deleted.add(message.id);
    }
    latestHistoryId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  for (const id of deleted) deleteCachedMessage(accountId, id);

  for (const [id, labelIds] of relabeled) {
    if (deleted.has(id) || added.has(id)) continue;
    if (labelIds.some((l) => DROP_LABELS.includes(l))) {
      deleteCachedMessage(accountId, id);
      continue;
    }
    const row = getCachedMessage(accountId, id);
    if (!row) continue;
    upsertCachedMessage({
      ...row,
      labelIds: JSON.stringify(labelIds),
      unread: labelIds.includes("UNREAD"),
      inInbox: labelIds.includes("INBOX"),
      syncedAt: new Date(),
    });
  }

  const received: string[] = [];
  const toFetch = [...added].filter(
    ([id, labels]) => !deleted.has(id) && !labels.includes("DRAFT") && !labels.some((l) => DROP_LABELS.includes(l))
  );
  await mapLimit(toFetch, 8, async ([id]) => {
    const wasCached = getCachedMessage(accountId, id) !== undefined;
    try {
      const row = toCacheRow(await getMessageMetadata(accountId, id), accountId);
      upsertCachedMessage(row);
      if (!wasCached) received.push(id);
    } catch (err) {
      if (!(err instanceof GmailApiError && err.status === 404)) throw err;
    }
  });

  setState(accountId, { historyId: latestHistoryId });
  return received;
}

async function publishReceived(accountId: number, accountEmail: string, messageIds: string[], now: Date): Promise<void> {
  if (messageIds.length === 0) return;
  const { includeAllCategories } = await getSettings();
  for (const id of messageIds) {
    const row = getCachedMessage(accountId, id);
    if (!row) continue;
    const summary = toSummary(row);
    if (!summary.inInbox || summary.labelIds.includes("SENT")) continue;
    if (now.getTime() - row.internalDate.getTime() > RECEIVED_MAX_AGE_MS) continue;
    if (!includeAllCategories && categoryOf(summary.labelIds) !== "primary") continue;
    void publishEvent({
      type: "mail.received",
      payload: {
        accountId,
        account: accountEmail,
        messageId: id,
        threadId: row.threadId,
        exhibitId: threadExhibitId(accountId, row.threadId),
        from: displayFrom(summary.from),
        fromEmail: summary.from.email ?? "",
        subject: summary.subject,
        snippet: summary.snippet,
        category: summary.category,
        url: threadUrl(accountId, row.threadId),
      },
    });
  }
}

export async function syncAccount(accountId: number, accountEmail: string, now = new Date()): Promise<void> {
  const state = getSyncState(accountId);
  try {
    if (!state?.historyId) {
      await backfill(accountId);
    } else {
      try {
        const received = await applyHistory(accountId, state.historyId);
        await publishReceived(accountId, accountEmail, received, now);
      } catch (err) {
        // 404 = the cursor is too old; start over from a fresh backfill.
        if (err instanceof GmailApiError && err.status === 404) await backfill(accountId);
        else throw err;
      }
    }
    setState(accountId, { lastSyncedAt: now, lastError: null });
  } catch (err) {
    const message =
      err instanceof GoogleScopeMissingError
        ? "Gmail access not granted"
        : err instanceof GoogleAccountNeedsReconnectError
          ? "Account needs reconnect"
          : (err as Error).message;
    setState(accountId, { lastError: message });
    throw err;
  }
}

let running: Promise<void> | null = null;

// Every account that granted Gmail access; one pass at a time.
export function syncAll(): Promise<void> {
  if (running) return running;
  running = (async () => {
    for (const account of listGoogleAccounts()) {
      if (account.needsReconnect || !hasGoogleScopes(account, MAIL_SCOPES)) continue;
      try {
        await syncAccount(account.id, account.email);
      } catch (err) {
        console.warn(`[mail] sync failed for ${account.email}: ${(err as Error).message}`);
      }
    }
    pruneCachedMessages(new Date(Date.now() - PRUNE_AFTER_MS));
  })().finally(() => {
    running = null;
  });
  return running;
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startMailSync(): void {
  void syncAll();
  timer = setInterval(() => void syncAll(), POLL_INTERVAL_MS);
}

export function stopMailSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
