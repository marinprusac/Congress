import { createHash } from "node:crypto";

export interface BankTransaction {
  key: string;
  bookingDate: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
}

type Raw = {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount?: { currency?: string; amount?: string };
  credit_debit_indicator?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
  note?: string;
};

// Null for what can't be a transaction (no amount or no date).
export function normalizeTransaction(accountUid: string, raw: unknown): BankTransaction | null {
  const t = raw as Raw;
  const magnitude = Math.abs(Number(t.transaction_amount?.amount));
  const date = t.booking_date ?? t.value_date ?? t.transaction_date;
  if (!Number.isFinite(magnitude) || !date) return null;
  const out = t.credit_debit_indicator === "DBIT";
  const description = (t.remittance_information ?? []).join(" ").trim() || t.note?.trim() || "";
  const counterparty = (out ? t.creditor?.name : t.debtor?.name)?.trim() ?? "";
  const stable = t.entry_reference || t.transaction_id;
  // Some banks send no id at all: fall back to what identifies the entry.
  const key = stable ? `${accountUid}:${stable}` : `${accountUid}:h${createHash("sha256").update([date, out, magnitude, counterparty, description].join("|")).digest("hex").slice(0, 20)}`;
  return { key, bookingDate: date, amount: out ? -magnitude : magnitude, currency: t.transaction_amount?.currency ?? "", counterparty, description };
}

// A whole fetch: two identical id-less entries (two coffees) get #2, #3 so neither overwrites the other.
export function normalizeTransactions(accountUid: string, raws: unknown[]): BankTransaction[] {
  const seen = new Map<string, number>();
  const out: BankTransaction[] = [];
  for (const raw of raws) {
    const t = normalizeTransaction(accountUid, raw);
    if (!t) continue;
    const n = (seen.get(t.key) ?? 0) + 1;
    seen.set(t.key, n);
    out.push(n === 1 ? t : { ...t, key: `${t.key}#${n}` });
  }
  return out;
}
