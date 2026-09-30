import { ConnectorRefusedError, defineConnector, type ConnectorContext } from "../contract.js";
import { closeGmailDb, runGmailMigrations } from "./db/client.js";
import { canModify, MAIL_SCOPES, markThreadReadInGmail } from "./api.js";
import { forgetAccount, getThreadRow, listThreadRows, parseThreadKey, rememberAccounts, toSourceRecord } from "./cache.js";
import { searchThreads, threadDetail } from "./detail.js";
import { refreshThread, syncAll } from "./sync.js";
import { gmailPanelRoutes } from "./routes.js";
import { registerGmailTools } from "./tools.js";

const onlyThreads = (kind: string) => {
  if (kind !== "thread") throw new ConnectorRefusedError(`no source kind "${kind}"`);
};

function accountOf(ctx: ConnectorContext, key: string) {
  const parsed = parseThreadKey(key);
  const account = parsed && ctx.google.accounts().find((a) => a.id === parsed.accountId);
  if (!parsed || !account) throw new ConnectorRefusedError(`No connected account for ${key}`);
  return { account, threadId: parsed.threadId };
}

// Gmail, read-only: one source record per thread. Only ever marks a thread read.
export const gmailConnector = defineConnector({
  name: "gmail",
  label: "Gmail",
  googleScopes: MAIL_SCOPES,
  source: [
    {
      kind: "thread",
      label: "Email thread",
      fields: [
        { slug: "subject", kind: "text", label: "Subject" },
        { slug: "from", kind: "text", label: "From" },
        { slug: "lastAt", kind: "datetime", label: "Last message" },
        { slug: "snippet", kind: "text", label: "Snippet" },
        { slug: "messageCount", kind: "number", label: "Messages" },
        { slug: "unread", kind: "boolean", label: "Unread" },
        { slug: "inbox", kind: "boolean", label: "In inbox" },
        { slug: "category", kind: "enum", label: "Category" },
        { slug: "starred", kind: "boolean", label: "Starred" },
        { slug: "important", kind: "boolean", label: "Important" },
        { slug: "sent", kind: "boolean", label: "You wrote in it" },
        { slug: "hasAttachments", kind: "boolean", label: "Attachments" },
        { slug: "account", kind: "text", label: "Account" },
        { slug: "gmailLink", kind: "text", label: "Gmail link" },
        { slug: "people", kind: "relation", label: "People", many: true, target: "person" },
      ],
      facts: [{ slug: "canMarkRead", label: "Can mark read" }],
    },
  ],
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
        exhibitId: { type: "string" },
        from: { type: "string" },
        fromEmail: { type: "string" },
        subject: { type: "string" },
        snippet: { type: "string" },
        category: { type: "string" },
        url: { type: "string" },
      },
    },
  ],
  start(ctx) {
    runGmailMigrations();
    rememberAccounts(ctx.google.accounts().map((a) => ({ id: a.id, email: a.email, label: a.label, modify: canModify(a.scopes) })));
  },
  stop: () => closeGmailDb(),
  sync: (ctx) => syncAll(ctx),
  intervalMs: () => 2 * 60_000,
  read: {
    get(kind, key) {
      onlyThreads(kind);
      const row = getThreadRow(key);
      return row ? toSourceRecord(row) : null;
    },
    list(kind, opts) {
      onlyThreads(kind);
      return listThreadRows(opts).map(toSourceRecord);
    },
    detail(ctx, kind, key, opts) {
      onlyThreads(kind);
      return threadDetail(ctx, key, opts);
    },
    search(ctx, kind, query, limit) {
      onlyThreads(kind);
      return searchThreads(ctx, query, limit);
    },
    async fetch(ctx, kind, key) {
      onlyThreads(kind);
      const { account, threadId } = accountOf(ctx, key);
      const stored = await refreshThread(ctx, account, threadId);
      const row = stored ? getThreadRow(stored) : undefined;
      return row ? toSourceRecord(row) : null;
    },
  },
  push: {
    create: () => Promise.reject(new ConnectorRefusedError("Gmail is read-only here")),
    update: () => Promise.reject(new ConnectorRefusedError("Gmail is read-only here")),
    delete: () => Promise.reject(new ConnectorRefusedError("Gmail is read-only here")),
    async act(ctx, kind, key, action) {
      onlyThreads(kind);
      if (action !== "markRead") throw new ConnectorRefusedError(`no action "${action}"`);
      const { account, threadId } = accountOf(ctx, key);
      if (!canModify(account.scopes)) throw new ConnectorRefusedError("Reconnect this account to let Congress mark mail read");
      await markThreadReadInGmail(ctx, account.id, threadId);
      await refreshThread(ctx, account, threadId);
      const row = getThreadRow(key);
      if (!row) throw new ConnectorRefusedError("That thread is gone from Gmail");
      return toSourceRecord(row);
    },
  },
  routes: (ctx) => gmailPanelRoutes(ctx),
  tools: (ctx, server) => registerGmailTools(ctx, server),
  onEvent(ctx, event) {
    const accountId = (event.payload as { accountId?: unknown } | null)?.accountId;
    if (event.type === "google.account_disconnected" && typeof accountId === "number") {
      for (const key of forgetAccount(accountId)) ctx.emitChange("thread", key, true);
    }
    if (event.type === "google.account_connected") ctx.syncNow();
  },
});
