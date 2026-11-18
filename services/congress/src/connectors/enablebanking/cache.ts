import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
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

// --- account labels

export interface AccountInfo {
  uid: string;
  bank: string;
  name: string;
  iban: string | null;
  currency: string;
  // What tells accounts apart to the owner and the AI: bank, currency, name, IBAN tail.
  label: string;
}

export function accountLabel(a: { name: string; iban: string | null; currency: string }, bank: string): string {
  const tail = a.iban ? `…${a.iban.slice(-4)}` : "";
  return [bank, a.currency, a.name, tail].filter(Boolean).join(" · ");
}

export function listAccountInfos(): AccountInfo[] {
  const banks = new Map(listConnections().map((c) => [c.sessionId, c.bank]));
  return listAccounts().map((a) => {
    const bank = banks.get(a.sessionId) ?? "";
    return { uid: a.uid, bank, name: a.name, iban: a.iban, currency: a.currency, label: accountLabel(a, bank) };
  });
}

// Accounts a free-text reference names: uid, IBAN or any part of the label ("revolut", "SE31", "…7374", "SEK").
export function matchAccounts(ref: string, all = listAccountInfos()): AccountInfo[] {
  const q = ref.trim().toLowerCase();
  if (!q) return all;
  const exact = all.filter((a) => a.uid.toLowerCase() === q || a.iban?.toLowerCase() === q);
  if (exact.length) return exact;
  return all.filter((a) => `${a.label} ${a.iban ?? ""}`.toLowerCase().includes(q.replace(/^…/, "")));
}

// --- transactions

export const getTransactionRow = (key: string): TxRow | undefined => db.select().from(transactions).where(eq(transactions.key, key)).get();

// Returns whether it was new or changed. A row's `transfer` mark is kept (it's decided afterwards, see markTransfers).
export function upsertTransaction(accountUid: string, t: BankTransaction): boolean {
  const before = getTransactionRow(t.key);
  if (
    before &&
    before.bookingDate === t.bookingDate &&
    before.amount === t.amount &&
    before.currency === t.currency &&
    before.counterparty === t.counterparty &&
    before.description === t.description &&
    before.mcc === t.mcc &&
    before.bankCode === t.bankCode &&
    before.counterpartyIban === t.counterpartyIban
  )
    return false;
  const row = {
    key: t.key,
    accountUid,
    bookingDate: t.bookingDate,
    amount: t.amount,
    currency: t.currency,
    counterparty: t.counterparty,
    description: t.description,
    mcc: t.mcc,
    bankCode: t.bankCode,
    counterpartyIban: t.counterpartyIban,
    updatedAt: new Date(),
  };
  db.insert(transactions).values(row).onConflictDoUpdate({ target: transactions.key, set: row }).run();
  return true;
}

// --- moves between the owner's own accounts

const PAIR_DAYS = 3;
const DAY_MS = 86_400_000;

// Marks entries that are the owner moving money between their own accounts, so they count as neither
// income nor spending (a top-up would otherwise be spending on one account and income on the other, and
// the same money would count again when it's spent). Two signals: the other party's IBAN is one of the
// owner's own accounts, or an entry has an equal and opposite twin on another account within 3 days.
// Returns the keys whose mark changed.
export function markTransfers(): string[] {
  const own = new Set(listAccounts().map((a) => a.iban).filter((i): i is string => Boolean(i)));
  const ibanOf = new Map(listAccounts().map((a) => [a.uid, a.iban]));
  const unmarked = db.select().from(transactions).where(eq(transactions.transfer, "")).all();
  const marked = new Set<string>();
  for (const t of unmarked) {
    if (t.counterpartyIban && own.has(t.counterpartyIban) && t.counterpartyIban !== ibanOf.get(t.accountUid)) marked.add(t.key);
  }
  // Twins: each outgoing entry takes the nearest-dated unclaimed incoming one of the same size and currency elsewhere.
  const incoming = unmarked.filter((t) => t.amount > 0 && !marked.has(t.key));
  const claimed = new Set<string>();
  for (const out of unmarked.filter((t) => t.amount < 0 && !marked.has(t.key)).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate))) {
    let best: TxRow | undefined;
    let bestGap = Infinity;
    for (const inc of incoming) {
      if (claimed.has(inc.key) || inc.accountUid === out.accountUid || inc.currency !== out.currency || inc.amount !== -out.amount) continue;
      const gap = Math.abs(Date.parse(inc.bookingDate) - Date.parse(out.bookingDate)) / DAY_MS;
      if (gap <= PAIR_DAYS && gap < bestGap) (best = inc), (bestGap = gap);
    }
    if (best) {
      claimed.add(best.key);
      marked.add(out.key);
      marked.add(best.key);
    }
  }
  for (const key of marked) db.update(transactions).set({ transfer: "own", updatedAt: new Date() }).where(eq(transactions.key, key)).run();
  return [...marked];
}

export function listTransactionRows(opts: { from?: string; to?: string; accountUids?: string[] } = {}): TxRow[] {
  const conds = [opts.accountUids ? inArray(transactions.accountUid, opts.accountUids) : undefined, opts.from ? gte(transactions.bookingDate, opts.from.slice(0, 10)) : undefined, opts.to ? lte(transactions.bookingDate, opts.to.slice(0, 10)) : undefined].filter((c) => c !== undefined);
  return db.select().from(transactions).where(conds.length ? and(...conds) : undefined).orderBy(desc(transactions.bookingDate)).all();
}

export function transactionRecord(row: TxRow): SourceRecord {
  const account = db.select().from(accounts).where(eq(accounts.uid, row.accountUid)).get();
  const accountText = account ? accountLabel(account, getConnection(account.sessionId)?.bank ?? "") : "";
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
      account: accountText,
      transfer: row.transfer === "own",
      mcc: row.mcc ?? "",
      bankCode: row.bankCode ?? ""
    },
    facts: {},
    updatedAt: row.updatedAt.toISOString(),
  };
}
