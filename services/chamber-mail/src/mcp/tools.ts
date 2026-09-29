import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { buildChipToken } from "@congress/shared-types";
import { listCachedMessages } from "../cache.js";
import { displayFrom } from "../gmail/mime.js";
import { syncAll } from "../sync.js";
import {
  getMessage,
  getThread,
  listAccountLabels,
  listMailAccounts,
  mailboxSummary,
  readAttachmentText,
  searchThreads,
} from "../mail.js";

// The chip token the AI copies into replies/notes to link a thread.
export function threadToken(exhibitId: string, subject: string): string {
  const label = subject.replace(/[|[\]\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Email";
  return buildChipToken({ chamber: "mail", id: exhibitId, name: label });
}

function fromLine(from: { name: string | null; email: string | null }): string {
  return from.name && from.email ? `${from.name} <${from.email}>` : displayFrom(from);
}

function errorResult(err: unknown) {
  return { ...textResult({ error: (err as Error).message }), isError: true };
}

async function run(fn: () => Promise<unknown> | unknown) {
  try {
    return textResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

const accountIdSchema = z.number().int().describe("Account id from list_accounts.");

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_accounts",
    {
      title: "List Mail Accounts",
      description:
        "List the Google accounts Mail can read (connected through Congress's Google connector), with whether Gmail access is granted and when each was last synced. Use the ids with the other tools.",
      inputSchema: {},
    },
    async () => run(() => listMailAccounts())
  );

  server.registerTool(
    "get_mailbox_summary",
    {
      title: "Mailbox Summary",
      description: "Unread counts per account, straight from Gmail: inbox unread threads, total inbox threads, and unread Primary-category threads (estimate).",
      inputSchema: {},
    },
    async () => run(() => mailboxSummary())
  );

  server.registerTool(
    "list_recent_mail",
    {
      title: "List Recent Mail",
      description:
        "Recent messages from the local mirror of the last ~30-90 days (fast, no Gmail call; refreshed every 2 minutes). One row per message, newest first, with sender, subject, Gmail snippet, labels and a chip `token` for the thread. Use search_mail for anything older or for precise Gmail queries, and get_thread to read full bodies.",
      inputSchema: {
        accountId: accountIdSchema.optional().describe("Only this account; omit for all."),
        unreadOnly: z.boolean().default(false),
        inboxOnly: z.boolean().default(true).describe("Only messages currently in the inbox."),
        categories: z
          .array(z.enum(["primary", "promotions", "social", "updates", "forums"]))
          .optional()
          .describe("Gmail inbox categories to include; omit for all."),
        sinceHours: z.number().positive().max(24 * 90).optional().describe("Only messages received in the last N hours."),
        limit: z.number().int().positive().max(100).default(25),
      },
    },
    async ({ accountId, unreadOnly, inboxOnly, categories, sinceHours, limit }) =>
      run(() =>
        listCachedMessages({
          accountId,
          unreadOnly,
          inboxOnly,
          categories,
          since: sinceHours ? new Date(Date.now() - sinceHours * 3600_000) : undefined,
          limit,
        }).map((m) => ({
          accountId: m.accountId,
          threadId: m.threadId,
          messageId: m.messageId,
          token: threadToken(m.exhibitId, m.subject),
          from: fromLine(m.from),
          subject: m.subject,
          date: m.date,
          unread: m.unread,
          category: m.category,
          labels: m.labelIds,
          hasAttachments: m.hasAttachments,
          snippet: m.snippet,
        }))
      )
  );

  server.registerTool(
    "search_mail",
    {
      title: "Search Mail",
      description:
        "Search the full Gmail mailbox (all time) with Gmail search syntax, across every readable account or one. Returns threads newest first with subject, latest sender, participants, snippet, unread flag and a chip `token`. Query examples: `from:alice@example.com`, `to:me subject:invoice`, `is:unread in:inbox category:primary`, `newer_than:7d`, `after:2026/09/01 before:2026/09/15`, `has:attachment filename:pdf`, `label:work`, `\"exact phrase\"`, `-in:chats`. Combine terms with spaces (AND) or `OR`.",
      inputSchema: {
        query: z.string().min(1).describe("Gmail search query."),
        accountId: accountIdSchema.optional().describe("Only this account; omit for all."),
        maxResults: z.number().int().positive().max(50).default(15).describe("Max threads (per account before merging)."),
      },
    },
    async ({ query, accountId, maxResults }) =>
      run(async () => {
        const { threads, errors } = await searchThreads(query, { accountId, maxResults });
        return {
          threads: threads.map((t) => ({
            accountId: t.accountId,
            account: t.accountEmail,
            threadId: t.threadId,
            token: threadToken(t.exhibitId, t.subject),
            subject: t.subject,
            from: fromLine(t.from),
            participants: t.participants,
            date: t.date,
            messageCount: t.messageCount,
            unread: t.unread,
            labels: t.labelIds,
            snippet: t.snippet,
          })),
          ...(errors.length ? { errors } : {}),
        };
      })
  );

  server.registerTool(
    "get_thread",
    {
      title: "Read Thread",
      description:
        "Read a whole email thread: every message's headers, plain-text body (HTML converted to text) and attachment list (use read_attachment with a partId to read one). Quoted reply history is stripped by default so each message shows only what's new.",
      inputSchema: {
        accountId: accountIdSchema,
        threadId: z.string().min(1),
        stripQuotes: z.boolean().default(true).describe("Drop quoted earlier messages from each body."),
        maxCharsPerMessage: z.number().int().positive().max(50_000).default(8_000),
      },
    },
    async ({ accountId, threadId, stripQuotes, maxCharsPerMessage }) =>
      run(async () => {
        const thread = await getThread(accountId, threadId, { stripQuotes, maxBodyChars: maxCharsPerMessage });
        return {
          accountId: thread.accountId,
          account: thread.accountEmail,
          threadId: thread.threadId,
          token: threadToken(thread.exhibitId, thread.subject),
          subject: thread.subject,
          labels: thread.labelIds,
          gmailUrl: thread.gmailUrl,
          messages: thread.messages.map((m) => ({
            messageId: m.messageId,
            from: fromLine(m.from),
            to: m.to,
            cc: m.cc,
            replyTo: m.replyTo,
            date: m.date,
            unread: m.unread,
            body: m.text,
            attachments: m.attachments.map((a) => ({ partId: a.partId, filename: a.filename, mimeType: a.mimeType, size: a.size })),
          })),
        };
      })
  );

  server.registerTool(
    "get_message",
    {
      title: "Read Message",
      description: "Read one message in full (headers, plain-text body including quoted history, attachment list).",
      inputSchema: {
        accountId: accountIdSchema,
        messageId: z.string().min(1),
        maxChars: z.number().int().positive().max(100_000).default(20_000),
      },
    },
    async ({ accountId, messageId, maxChars }) =>
      run(async () => {
        const m = await getMessage(accountId, messageId, { maxBodyChars: maxChars });
        return {
          messageId: m.messageId,
          threadId: m.threadId,
          from: fromLine(m.from),
          to: m.to,
          cc: m.cc,
          replyTo: m.replyTo,
          date: m.date,
          subject: m.subject,
          labels: m.labelIds,
          body: m.text,
          attachments: m.attachments.map((a) => ({ partId: a.partId, filename: a.filename, mimeType: a.mimeType, size: a.size })),
        };
      })
  );

  server.registerTool(
    "read_attachment",
    {
      title: "Read Attachment",
      description:
        "Read a text-like attachment (plain text, CSV, HTML, JSON, calendar invites, forwarded emails) as text, up to 100k characters. Binary files (PDF, images, Office documents) only return their metadata.",
      inputSchema: {
        accountId: accountIdSchema,
        messageId: z.string().min(1),
        partId: z.string().describe("The attachment's partId from get_thread/get_message."),
      },
    },
    async ({ accountId, messageId, partId }) => run(() => readAttachmentText(accountId, messageId, partId))
  );

  server.registerTool(
    "list_labels",
    {
      title: "List Labels",
      description: "List an account's Gmail labels (system and the owner's own) - their names work in search_mail as `label:<name>`.",
      inputSchema: { accountId: accountIdSchema },
    },
    async ({ accountId }) =>
      run(async () => (await listAccountLabels(accountId)).map((l) => ({ id: l.id, name: l.name, type: l.type })))
  );

  server.registerTool(
    "refresh_mail",
    {
      title: "Refresh Mail",
      description: "Sync the local mirror with Gmail now instead of waiting for the next 2-minute poll. Returns each account's sync status.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        await syncAll();
        return listMailAccounts().map((a) => ({ id: a.id, email: a.email, lastSyncedAt: a.lastSyncedAt, lastError: a.lastError }));
      })
  );
}
