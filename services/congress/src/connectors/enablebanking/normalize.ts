import { createHash } from "node:crypto";

export interface BankTransaction {
  key: string;
  bookingDate: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  mcc: string | null;
  bankCode: string | null;
  counterpartyIban: string | null;
}

type Raw = {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount?: { currency?: string; amount?: string };
  credit_debit_indicator?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  creditor_account?: { iban?: string };
  debtor_account?: { iban?: string };
  merchant_category_code?: string | null;
  bank_transaction_code?: { description?: string; code?: string };
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  note?: string;
};

// Zagrebačka banka's API reports every entry as a credit, card purchases and fees included
// (seen 2026-11-18: 32 of 32 "CRDT", no balances to check against). Its statement text says which are
// really money out: "Kupovina …" (purchase) and "Naknada …" (fee). Only Croatian entries are touched.
const CROATIAN_OUTGOING = /^(Kupovina|Naknada)\b/i;

export interface NormalizeContext {
  // The bank's country, for per-bank quirks.
  country?: string;
}

// Null for what can't be a transaction (no amount or no date).
export function normalizeTransaction(accountUid: string, raw: unknown, ctx: NormalizeContext = {}): BankTransaction | null {
  const t = raw as Raw;
  const magnitude = Math.abs(Number(t.transaction_amount?.amount));
  const date = t.booking_date ?? t.value_date ?? t.transaction_date;
  if (!Number.isFinite(magnitude) || !date) return null;
  const description = (t.remittance_information ?? []).join(" ").trim() || t.note?.trim() || "";
  // Some banks send no indicator and a signed amount instead.
  const out = t.credit_debit_indicator === "DBIT" || (!t.credit_debit_indicator && Number(t.transaction_amount?.amount) < 0) || (ctx.country === "HR" && t.credit_debit_indicator === "CRDT" && CROATIAN_OUTGOING.test(description));
  const counterparty = (out ? t.creditor?.name : t.debtor?.name)?.trim() ?? "";
  const stable = t.entry_reference || t.transaction_id;
  // Some banks send no id at all: fall back to what identifies the entry.
  const key = stable ? `${accountUid}:${stable}` : `${accountUid}:h${createHash("sha256").update([date, out, magnitude, counterparty, description].join("|")).digest("hex").slice(0, 20)}`;
  const counterpartyIban = (out ? t.creditor_account?.iban : t.debtor_account?.iban) ?? null;
  return {
    key,
    bookingDate: date,
    amount: out ? -magnitude : magnitude,
    currency: t.transaction_amount?.currency ?? "",
    counterparty,
    description,
    mcc: t.merchant_category_code || null,
    bankCode: t.bank_transaction_code?.description || t.bank_transaction_code?.code || null,
    counterpartyIban,
  };
}

// A whole fetch: two identical id-less entries (two coffees) get #2, #3 so neither overwrites the other.
export function normalizeTransactions(accountUid: string, raws: unknown[], ctx: NormalizeContext = {}): BankTransaction[] {
  const seen = new Map<string, number>();
  const out: BankTransaction[] = [];
  for (const raw of raws) {
    const t = normalizeTransaction(accountUid, raw, ctx);
    if (!t) continue;
    const n = (seen.get(t.key) ?? 0) + 1;
    seen.set(t.key, n);
    out.push(n === 1 ? t : { ...t, key: `${t.key}#${n}` });
  }
  return out;
}
