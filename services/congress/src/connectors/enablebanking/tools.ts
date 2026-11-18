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
      description: "Synced booked transactions, newest first, each with the account it belongs to. Amounts are signed (negative = money out).",
      inputSchema: {
        from: z.string().optional().describe("YYYY-MM-DD, inclusive"),
        to: z.string().optional().describe("YYYY-MM-DD, inclusive"),
        account: accountRef,
        query: z.string().optional().describe("Only transactions whose counterparty or description contains this"),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    ({ from, to, account, query, limit }) =>
      safe(() => {
        const accts = new Map(listAccountInfos().map((a) => [a.uid, a]));
        const matched = account ? matchAccounts(account) : undefined;
        if (matched && matched.length === 0) return { error: `No account matches "${account}"`, accounts: [...accts.values()].map((a) => a.label) };
        const q = query?.toLowerCase();
        return listTransactionRows({ from, to, accountUids: matched?.map((a) => a.uid) })
          .filter((t) => !q || `${t.counterparty} ${t.description}`.toLowerCase().includes(q))
          .slice(0, limit)
          .map((t) => ({ date: t.bookingDate, amount: t.amount, currency: t.currency, counterparty: t.counterparty, description: t.description, account: accts.get(t.accountUid)?.label ?? t.accountUid, accountId: t.accountUid }));
      })
  );

  server.registerTool(
    "banks_spending",
    {
      title: "Summarize spending",
      description:
        "Money in and out over a date range from the synced transactions, per account (with its bank, currency and top counterparties) and totalled per currency. Optionally limited to one account. Transfers between your own accounts count as spending and income.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD, inclusive"),
        to: z.string().describe("YYYY-MM-DD, inclusive"),
        account: accountRef,
        top: z.number().int().min(1).max(50).default(10),
      },
    },
    ({ from, to, account, top }) =>
      safe(() => {
        const all = listAccountInfos();
        const matched = account ? matchAccounts(account, all) : all;
        if (matched.length === 0) return { error: `No account matches "${account}"`, accounts: all.map((a) => a.label) };
        const rows = listTransactionRows({ from, to, accountUids: matched.map((a) => a.uid) });
        const totals: Record<string, { in: number; out: number }> = {};
        const accounts = matched.map((a) => {
          let inn = 0;
          let out = 0;
          const by = new Map<string, number>();
          for (const t of rows) {
            if (t.accountUid !== a.uid) continue;
            const tot = (totals[t.currency] ??= { in: 0, out: 0 });
            if (t.amount < 0) {
              out += -t.amount;
              tot.out += -t.amount;
              const who = t.counterparty || t.description || "(unknown)";
              by.set(who, (by.get(who) ?? 0) + -t.amount);
            } else {
              inn += t.amount;
              tot.in += t.amount;
            }
          }
          return { accountId: a.uid, label: a.label, bank: a.bank, currency: a.currency, in: round(inn), out: round(out), topSpending: [...by].sort((x, y) => y[1] - x[1]).slice(0, top).map(([counterparty, amount]) => ({ counterparty, amount: round(amount) })) };
        });
        return { accounts, totalsPerCurrency: Object.entries(totals).map(([currency, t]) => ({ currency, in: round(t.in), out: round(t.out) })) };
      })
  );
}
