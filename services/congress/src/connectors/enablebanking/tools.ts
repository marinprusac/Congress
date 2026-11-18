import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../../kit/mcp.js";
import type { ConnectorContext } from "../contract.js";
import { fetchBalances } from "./client.js";
import { accountLabel, credentials, isExpired, listAccountInfos, listAccounts, listConnections, listTransactionRows, matchAccounts } from "./cache.js";

async function safe(fn: () => Promise<unknown> | unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    return mcpTextResult({ error: (err as Error).message });
  }
}

const accountRef = z.string().optional().describe("One account: its accountId, an IBAN, or part of its label such as 'revolut', 'SEK' or '7374'. Omit for all accounts.");

const round = (n: number) => Math.round(n * 100) / 100;

// Read-only: nothing here can move money.
export function registerBankTools(_ctx: ConnectorContext, server: McpServer): void {
  server.registerTool(
    "banks_list_accounts",
    {
      title: "List bank accounts",
      description:
        "Connected bank accounts with live balances and consent status. Each has an accountId; pass it (or an IBAN, or part of the label like 'revolut' or 'SEK') as `account` to the other banks_* tools to look at one account.",
      inputSchema: {},
    },
    () =>
      safe(async () => {
        const creds = credentials();
        if (!creds) return { error: "No Enable Banking credentials are set" };
        const consent = new Map(listConnections().map((c) => [c.sessionId, c]));
        const out = [];
        for (const a of listAccounts()) {
          const conn = consent.get(a.sessionId);
          const expired = !conn || isExpired(conn);
          // A balance read counts against the bank's daily allowance, so only for live consents.
          const balances = expired ? [] : await fetchBalances(creds, a.uid).catch((e: Error) => [{ type: "error", currency: "", amount: e.message }]);
          out.push({ accountId: a.uid, label: accountLabel(a, conn?.bank ?? ""), bank: conn?.bank, name: a.name || null, iban: a.iban, currency: a.currency, consentValidUntil: conn?.validUntil, consentExpired: expired, balances });
        }
        return out;
      })
  );

  server.registerTool(
    "banks_list_transactions",
    {
      title: "List bank transactions",
      description:
        "Synced booked transactions, newest first, each with the account it belongs to and who the money came from or went to (counterparty, else the bank's statement text). Amounts are signed (negative = money out). `transfer: true` marks a move between the owner's own accounts (e.g. a Revolut top-up), which is neither income nor spending.",
      inputSchema: {
        from: z.string().optional().describe("YYYY-MM-DD, inclusive"),
        to: z.string().optional().describe("YYYY-MM-DD, inclusive"),
        account: accountRef,
        query: z.string().optional().describe("Only transactions whose counterparty or description contains this"),
        direction: z.enum(["in", "out", "all"]).default("all"),
        includeTransfers: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    ({ from, to, account, query, direction = "all", includeTransfers = true, limit = 50 }) =>
      safe(() => {
        const accts = new Map(listAccountInfos().map((a) => [a.uid, a]));
        const matched = account ? matchAccounts(account) : undefined;
        if (matched && matched.length === 0) return { error: `No account matches "${account}"`, accounts: [...accts.values()].map((a) => a.label) };
        const q = query?.toLowerCase();
        return listTransactionRows({ from, to, accountUids: matched?.map((a) => a.uid) })
          .filter((t) => (includeTransfers || t.transfer === "") && (direction === "all" || (direction === "in" ? t.amount > 0 : t.amount < 0)) && (!q || `${t.counterparty} ${t.description}`.toLowerCase().includes(q)))
          .slice(0, limit)
          .map((t) => ({
            date: t.bookingDate,
            amount: t.amount,
            currency: t.currency,
            counterparty: t.counterparty || null,
            description: t.description,
            transfer: t.transfer === "own",
            ...(t.mcc ? { merchantCategoryCode: t.mcc } : {}),
            ...(t.bankCode ? { bankCode: t.bankCode } : {}),
            account: accts.get(t.accountUid)?.label ?? t.accountUid,
            accountId: t.accountUid,
          }));
      })
  );

  server.registerTool(
    "banks_spending",
    {
      title: "Summarize income and spending",
      description:
        "Income and spending over a date range from the synced transactions: per account (with its bank and currency; the biggest sources of income `topIncome` and what the money went on `topSpending`, by counterparty or statement text), totalled per currency and per month. Moves between the owner's own accounts (transfers, e.g. topping up Revolut) are left out so money isn't counted twice; they're reported separately under `transfersExcluded`. Optionally limited to one account.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD, inclusive"),
        to: z.string().describe("YYYY-MM-DD, inclusive"),
        account: accountRef,
        includeTransfers: z.boolean().default(false).describe("Count own-account transfers as income/spending too (double counts money that moves between accounts)"),
        top: z.number().int().min(1).max(50).default(10),
      },
    },
    ({ from, to, account, includeTransfers = false, top = 10 }) =>
      safe(() => {
        const all = listAccountInfos();
        const matched = account ? matchAccounts(account, all) : all;
        if (matched.length === 0) return { error: `No account matches "${account}"`, accounts: all.map((a) => a.label) };
        const rows = listTransactionRows({ from, to, accountUids: matched.map((a) => a.uid) });
        const who = (t: { counterparty: string; description: string }) => (t.counterparty || t.description || "(unknown)").slice(0, 60);
        const totals: Record<string, { in: number; out: number }> = {};
        const months: Record<string, { month: string; currency: string; in: number; out: number }> = {};
        const excluded: Record<string, { currency: string; count: number; moved: number }> = {};
        const top5 = (m: Map<string, number>) => [...m].sort((x, y) => y[1] - x[1]).slice(0, top).map(([counterparty, amount]) => ({ counterparty, amount: round(amount) }));
        const accounts = matched.map((a) => {
          let inn = 0;
          let out = 0;
          const spent = new Map<string, number>();
          const earned = new Map<string, number>();
          for (const t of rows) {
            if (t.accountUid !== a.uid) continue;
            if (t.transfer === "own" && !includeTransfers) {
              const e = (excluded[t.currency] ??= { currency: t.currency, count: 0, moved: 0 });
              e.count++;
              if (t.amount < 0) e.moved += -t.amount;
              continue;
            }
            const tot = (totals[t.currency] ??= { in: 0, out: 0 });
            const mo = (months[`${t.bookingDate.slice(0, 7)}|${t.currency}`] ??= { month: t.bookingDate.slice(0, 7), currency: t.currency, in: 0, out: 0 });
            if (t.amount < 0) {
              out += -t.amount;
              tot.out += -t.amount;
              mo.out += -t.amount;
              spent.set(who(t), (spent.get(who(t)) ?? 0) + -t.amount);
            } else {
              inn += t.amount;
              tot.in += t.amount;
              mo.in += t.amount;
              earned.set(who(t), (earned.get(who(t)) ?? 0) + t.amount);
            }
          }
          return { accountId: a.uid, label: a.label, bank: a.bank, currency: a.currency, in: round(inn), out: round(out), topIncome: top5(earned), topSpending: top5(spent) };
        });
        return {
          accounts,
          totalsPerCurrency: Object.entries(totals).map(([currency, t]) => ({ currency, in: round(t.in), out: round(t.out) })),
          byMonth: Object.values(months).sort((x, y) => x.month.localeCompare(y.month) || x.currency.localeCompare(y.currency)).map((m) => ({ ...m, in: round(m.in), out: round(m.out) })),
          transfersExcluded: Object.values(excluded).map((e) => ({ currency: e.currency, entries: e.count, movedOut: round(e.moved) })),
        };
      })
  );
}
