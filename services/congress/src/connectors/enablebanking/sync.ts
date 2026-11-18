import type { ConnectorContext, SyncResult } from "../contract.js";
import { fetchTransactions } from "./client.js";
import { credentials, getBankSettings, isExpired, listAccounts, listConnections, markFetched, setSyncedThrough, updateBankSettings, updateConnection, upsertTransaction } from "./cache.js";
import { normalizeTransactions } from "./normalize.js";

// A first pull reaches back this far (banks cap what they serve; 90 days is the usual SCA window).
const FIRST_DAYS = 90;
// Booked entries can still be amended for a few days; re-read this far back.
const OVERLAP_DAYS = 7;
const WARN_DAYS = 7;
const FAILURE_ALERT_THRESHOLD = 3;
const DAY = 86_400_000;
// Banks allow ~4 unattended reads per account a day: never ask one account more often than this,
// however often the service restarts or Sync now is pressed.
const MIN_GAP_MS = 5 * 3_600_000;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

let running: Promise<SyncResult> | null = null;

// PSD2 lets us read an account unattended only ~4 times a day, so this runs every 6 hours.
export function syncBanks(ctx: ConnectorContext, now = Date.now()): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    const creds = credentials();
    if (!creds) return { changed: 0, error: null };
    const errors: string[] = [];
    let changed = 0;
    for (const conn of listConnections()) {
      if (conn.status !== "active") continue;
      if (isExpired(conn, now)) {
        errors.push(`${conn.bank}: consent expired, reconnect it`);
        continue;
      }
      if (!conn.expiryNotified && Date.parse(conn.validUntil) - now < WARN_DAYS * DAY) {
        updateConnection(conn.sessionId, { expiryNotified: true });
        ctx.publish("banks.consent_expiring", { bank: conn.bank, validUntil: conn.validUntil });
      }
      for (const acc of listAccounts(conn.sessionId)) {
        if (acc.lastFetchedAt !== null && now - acc.lastFetchedAt < MIN_GAP_MS) continue;
        markFetched(acc.uid, now);
        try {
          const first = acc.syncedThrough === null;
          const from = first ? day(now - FIRST_DAYS * DAY) : day(Date.parse(acc.syncedThrough!) - OVERLAP_DAYS * DAY);
          const quiet = first;
          let latest = acc.syncedThrough;
          for (const t of normalizeTransactions(acc.uid, await fetchTransactions(creds, acc.uid, from))) {
            if (!latest || t.bookingDate > latest) latest = t.bookingDate;
            if (upsertTransaction(acc.uid, t)) {
              ctx.emitChange("transaction", t.key, false, quiet);
              changed++;
            }
          }
          setSyncedThrough(acc.uid, latest ?? day(now));
        } catch (err) {
          errors.push(`${conn.bank} ${acc.name || acc.iban || acc.uid}: ${(err as Error).message}`);
        }
      }
    }
    const settings = getBankSettings();
    if (errors.length === 0) {
      updateBankSettings({ consecutiveFailures: 0, lastError: null });
      return { changed, error: null };
    }
    const failures = settings.consecutiveFailures + 1;
    const message = errors.join("\n");
    updateBankSettings({ consecutiveFailures: failures, lastError: message });
    if (failures === FAILURE_ALERT_THRESHOLD) ctx.publish("banks.sync_failing", { consecutiveFailures: failures, lastError: message });
    return { changed, error: message };
  })().finally(() => {
    running = null;
  });
  return running;
}
