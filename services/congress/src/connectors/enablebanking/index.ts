import { defineConnector } from "../contract.js";
import { closeBankDb, runBankMigrations } from "./db/client.js";
import { getTransactionRow, listTransactionRows, transactionRecord } from "./cache.js";
import { syncBanks } from "./sync.js";
import { bankHooks, bankPanelRoutes } from "./routes.js";
import { registerBankTools } from "./tools.js";

// Bank accounts through Enable Banking (PSD2 open banking). Read-only, forever:
// no `push`, so nothing can be paid, moved or changed.
export const enableBankingConnector = defineConnector({
  name: "enablebanking",
  label: "Banks",
  source: [
    {
      kind: "transaction",
      label: "Transaction",
      fields: [
        { slug: "title", kind: "text", label: "Title" },
        { slug: "date", kind: "date", label: "Booked" },
        { slug: "amount", kind: "number", label: "Amount (negative = spent)" },
        { slug: "currency", kind: "text", label: "Currency" },
        { slug: "counterparty", kind: "text", label: "Counterparty" },
        { slug: "description", kind: "text", label: "Description" },
        { slug: "account", kind: "text", label: "Account" },
      ],
      facts: [],
    },
  ],
  events: [
    { type: "banks.consent_expiring", label: "Bank consent expiring", description: "A bank connection runs out within a week and must be re-approved.", payloadFields: { bank: { type: "string" }, validUntil: { type: "string" } } },
    { type: "banks.sync_failing", label: "Bank sync failing", description: "Reading the banks failed three syncs in a row.", payloadFields: { consecutiveFailures: { type: "number" }, lastError: { type: "string" } } },
  ],
  start: () => runBankMigrations(),
  stop: () => closeBankDb(),
  sync: (ctx) => syncBanks(ctx),
  // Banks allow ~4 unattended reads per account per day.
  intervalMs: () => 6 * 3_600_000,
  read: {
    get(kind, key) {
      const row = kind === "transaction" ? getTransactionRow(key) : undefined;
      return row ? transactionRecord(row) : null;
    },
    list: (kind, opts) => (kind === "transaction" ? listTransactionRows(opts).map(transactionRecord) : []),
  },
  routes: (ctx) => bankPanelRoutes(ctx),
  hooks: (ctx) => bankHooks(ctx),
  tools: (ctx, server) => registerBankTools(ctx, server),
});
