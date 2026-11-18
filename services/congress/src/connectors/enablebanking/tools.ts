import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../../kit/mcp.js";
import type { ConnectorContext } from "../contract.js";
import { fetchBalances } from "./client.js";
import { credentials, isExpired, listAccounts, listConnections, listTransactionRows } from "./cache.js";

async function safe(fn: () => Promise<unknown> | unknown) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    return mcpTextResult({ error: (err as Error).message });
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

// Read-only: nothing here can move money.
export function registerBankTools(_ctx: ConnectorContext, server: McpServer): void {
  server.registerTool(
    "banks_list_accounts",
    { title: "List bank accounts", description: "Connected bank accounts with live balances, and whether each bank consent is still valid.", inputSchema: {} },
    () =>
      safe(async () => {
        const creds = credentials();
        if (!creds) return { error: "No Enable Banking credentials are set" };
        const out = [];
        for (const conn of listConnections()) {
          const expired = isExpired(conn);
          for (const a of listAccounts(conn.sessionId)) {
            // A balance read counts against the bank's daily allowance, so only for live consents.
            const balances = expired ? [] : await fetchBalances(creds, a.uid).catch((e: Error) => [{ type: "error", currency: "", amount: e.message }]);
            out.push({ bank: conn.bank, account: a.name || a.iban, iban: a.iban, currency: a.currency, consentValidUntil: conn.validUntil, consentExpired: expired, balances });
          }
        }
        return out;
      })
  );

  server.registerTool(
    "banks_spending",
    {
      title: "Summarize spending",
      description: "Money in and out over a date range from the synced transactions, per currency and per counterparty (largest first). Transfers between your own accounts count as spending and income.",
      inputSchema: { from: z.string().describe("YYYY-MM-DD, inclusive"), to: z.string().describe("YYYY-MM-DD, inclusive"), top: z.number().int().min(1).max(50).default(10) },
    },
    ({ from, to, top }) =>
      safe(() => {
        const byCurrency: Record<string, { in: number; out: number; byCounterparty: Map<string, number> }> = {};
        for (const t of listTransactionRows({ from, to })) {
          const c = (byCurrency[t.currency] ??= { in: 0, out: 0, byCounterparty: new Map() });
          if (t.amount < 0) {
            c.out += -t.amount;
            const who = t.counterparty || t.description || "(unknown)";
            c.byCounterparty.set(who, (c.byCounterparty.get(who) ?? 0) + -t.amount);
          } else c.in += t.amount;
        }
        return Object.entries(byCurrency).map(([currency, c]) => ({
          currency,
          in: round(c.in),
          out: round(c.out),
          topSpending: [...c.byCounterparty].sort((a, b) => b[1] - a[1]).slice(0, top).map(([counterparty, amount]) => ({ counterparty, amount: round(amount) })),
        }));
      })
  );
}
