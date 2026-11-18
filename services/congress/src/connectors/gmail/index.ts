import { defineConnector } from "../contract.js";
import { closeGmailDb, runGmailMigrations } from "./db/client.js";
import { MAIL_SCOPES } from "./api.js";
import { forgetAccount } from "./cache.js";
import { syncAll } from "./sync.js";
import { gmailPanelRoutes } from "./routes.js";
import { registerGmailTools } from "./tools.js";

// Gmail, read-only: nothing is ever sent, changed or deleted. Mail isn't
// records in Congress (it belongs to Gmail); the AI reads it live through its
// gmail_* tools, and new inbox mail is announced as mail.received.
export const gmailConnector = defineConnector({
  name: "gmail",
  label: "Gmail",
  googleScopes: MAIL_SCOPES,
  source: [],
  events: [
    {
      type: "mail.received",
      label: "Mail received",
      description:
        "A new message arrived in a connected inbox. Primary category only, unless Gmail's settings include every category; the owner's own sent mail never counts.",
      payloadFields: {
        accountId: { type: "number" },
        account: { type: "string" },
        messageId: { type: "string" },
        threadId: { type: "string" },
        from: { type: "string" },
        fromEmail: { type: "string" },
        subject: { type: "string" },
        snippet: { type: "string" },
        category: { type: "string" },
        url: { type: "string" },
      },
    },
  ],
  start: () => runGmailMigrations(),
  stop: () => closeGmailDb(),
  sync: (ctx) => syncAll(ctx),
  intervalMs: () => 2 * 60_000,
  read: { get: () => null, list: () => [] },
  routes: (ctx) => gmailPanelRoutes(ctx),
  tools: (ctx, server) => registerGmailTools(ctx, server),
  onEvent(ctx, event) {
    const accountId = (event.payload as { accountId?: unknown } | null)?.accountId;
    if (event.type === "google.account_disconnected" && typeof accountId === "number") forgetAccount(accountId);
    if (event.type === "google.account_connected") ctx.syncNow();
  },
});
