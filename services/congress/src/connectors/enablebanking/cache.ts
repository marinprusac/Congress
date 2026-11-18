import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { SourceRecord } from "../contract.js";
import { bankDb as db } from "./db/client.js";
import { accounts, connections, pendingAuths, settings, transactions } from "./db/schema.js";
import type { BankTransaction } from "./normalize.js";

type TxRow = typeof transactions.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;

// --- settings

export type BankSettings = typeof settings.$inferSelect;

export const getBankSettings = (): BankSettings => db.select().from(settings).where(eq(settings.id, 1)).get() ?? { id: 1, appId: null, privateKey: null, consecutiveFailures: 0, lastError: null };

export function updateBankSettings(patch: Partial<Omit<BankSettings, "id">>): BankSettings {
  const next = { ...getBankSettings(), ...patch, id: 1 };
  db.insert(settings).values(next).onConflictDoUpdate({ target: settings.id, set: next }).run();
  return next;
}

export function credentials() {
  const s = getBankSettings();
  return s.appId && s.privateKey ? { appId: s.appId, privateKey: s.privateKey } : null;
}

// --- consents

const PENDING_TTL_MS = 30 * 60_000;

export function addPendingAuth(state: string, bank: string, country: string, now = Date.now()): void {
  db.delete(pendingAuths).where(lte(pendingAuths.createdAt, now - PENDING_TTL_MS)).run();
  db.insert(pendingAuths).values({ state, bank, country, createdAt: now }).run();
}

// One use: the nonce is gone once taken. Null if unknown or expired.
export function takePendingAuth(state: string, now = Date.now()): { bank: string; country: string } | null {
  const row = db.select().from(pendingAuths).where(eq(pendingAuths.state, state)).get();
  if (!row) return null;
  db.delete(pendingAuths).where(eq(pendingAuths.state, state)).run();
  return now - row.createdAt > PENDING_TTL_MS ? null : { bank: row.bank, country: row.country };
}

export function saveConnection(c: { sessionId: string; bank: string; country: string; validUntil: string; accounts: { uid: string; name: string; iban: string | null; currency: string }[] }, now = Date.now()): void {
  db.transaction((tx) => {
    tx.insert(connections).values({ sessionId: c.sessionId, bank: c.bank, country: c.country, validUntil: c.validUntil, createdAt: now }).onConflictDoNothing().run();
    for (const a of c.accounts) {
      tx.insert(accounts).values({ uid: a.uid, sessionId: c.sessionId, name: a.name, iban: a.iban, currency: a.currency }).onConflictDoNothing().run();
    }
  });
}

export const listConnections = (): ConnectionRow[] => db.select().from(connections).orderBy(desc(connections.createdAt)).all();
export const getConnection = (sessionId: string) => db.select().from(connections).where(eq(connections.sessionId, sessionId)).get();
export const updateConnection = (sessionId: string, patch: Partial<Omit<ConnectionRow, "sessionId">>) => db.update(connections).set(patch).where(eq(connections.sessionId, sessionId)).run();
export const listAccounts = (sessionId?: string): AccountRow[] => (sessionId ? db.select().from(accounts).where(eq(accounts.sessionId, sessionId)).all() : db.select().from(accounts).all());
export const setSyncedThrough = (uid: string, date: string) => db.update(accounts).set({ syncedThrough: date }).where(eq(accounts.uid, uid)).run();
export const markFetched = (uid: string, at: number) => db.update(accounts).set({ lastFetchedAt: at }).where(eq(accounts.uid, uid)).run();

export const isExpired = (c: ConnectionRow, now = Date.now()) => c.status !== "active" || Date.parse(c.validUntil) <= now;

// --- transactions

export const getTransactionRow = (key: string): TxRow | undefined => db.select().from(transactions).where(eq(transactions.key, key)).get();

// Returns whether it was new or changed.
export function upsertTransaction(accountUid: string, t: BankTransaction): boolean {
  const before = getTransactionRow(t.key);
  if (before && before.bookingDate === t.bookingDate && before.amount === t.amount && before.currency === t.currency && before.counterparty === t.counterparty && before.description === t.description) return false;
  const row = { key: t.key, accountUid, bookingDate: t.bookingDate, amount: t.amount, currency: t.currency, counterparty: t.counterparty, description: t.description, updatedAt: new Date() };
  db.insert(transactions).values(row).onConflictDoUpdate({ target: transactions.key, set: row }).run();
  return true;
}

export function listTransactionRows(opts: { from?: string; to?: string } = {}): TxRow[] {
  const conds = [opts.from ? gte(transactions.bookingDate, opts.from.slice(0, 10)) : undefined, opts.to ? lte(transactions.bookingDate, opts.to.slice(0, 10)) : undefined].filter((c) => c !== undefined);
  return db.select().from(transactions).where(conds.length ? and(...conds) : undefined).orderBy(desc(transactions.bookingDate)).all();
}

export function transactionRecord(row: TxRow): SourceRecord {
  const account = db.select().from(accounts).where(eq(accounts.uid, row.accountUid)).get();
  const label = row.counterparty || row.description || "Transaction";
  return {
    kind: "transaction",
    key: row.key,
    values: {
      title: label,
      date: row.bookingDate,
      amount: row.amount,
      currency: row.currency,
      counterparty: row.counterparty,
      description: row.description,
      account: account ? (account.name || account.iban || "") : "",
    },
    facts: {},
    updatedAt: row.updatedAt.toISOString(),
  };
}
