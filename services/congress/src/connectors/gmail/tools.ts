import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../../kit/mcp.js";
import type { ConnectorContext } from "../contract.js";
import { listLabels } from "./api.js";
import { mailboxSummary, readAttachmentText, searchThreads, threadDetail } from "./detail.js";

async function safe(fn: () => Promise<unknown>) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    return mcpTextResult({ error: (err as Error).message });
  }
}

// The AI's only way into Gmail: live reads, nothing stored in Congress. Read-only; nothing is sent, changed or deleted.
export function registerGmailTools(ctx: ConnectorContext, server: McpServer): void {
  server.registerTool(
    "gmail_search",
    {
      title: "Search Gmail",
      description:
        "Search every connected Gmail account live with Gmail's query syntax (from:, to:, subject:, in:sent, is:unread, newer_than:7d, label:x ...). Returns thread summaries (key, subject, sender, last message, snippet, unread, people on it; \"you wrote to them\" marks the owner's direct contact), newest first. Read one with gmail_read_thread.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(30).default(10) },
    },
    ({ query, limit }) => safe(() => searchThreads(ctx, query, limit))
  );

  server.registerTool(
    "gmail_read_thread",
    {
      title: "Read Gmail thread",
      description: "A whole thread live, as plain text (quoted replies stripped, long messages capped) with each message's attachments (partId for gmail_read_attachment). key is \"<accountId>:<threadId>\" from gmail_search.",
      inputSchema: { key: z.string().min(1) },
    },
    ({ key }) => safe(() => threadDetail(ctx, key))
  );

  server.registerTool(
    "gmail_mailbox_summary",
    {
      title: "Gmail mailbox summary",
      description: "Live inbox counts per connected Gmail account (unread threads, primary unread), and when each last synced.",
      inputSchema: {},
    },
    () => safe(() => mailboxSummary(ctx))
  );

  server.registerTool(
    "gmail_read_attachment",
    {
      title: "Read Gmail attachment",
      description: "The text of a text-like attachment (gmail_read_thread lists each message's attachments with messageId and partId; accountId is the start of the thread key). Binary files only report metadata.",
      inputSchema: { accountId: z.number().int(), messageId: z.string().min(1), partId: z.string().min(1) },
    },
    ({ accountId, messageId, partId }) => safe(() => readAttachmentText(ctx, accountId, messageId, partId))
  );

  server.registerTool(
    "gmail_list_labels",
    { title: "List Gmail labels", description: "An account's Gmail labels (for gmail_search queries like label:x).", inputSchema: { accountId: z.number().int() } },
    ({ accountId }) => safe(() => listLabels(ctx, accountId))
  );

  server.registerTool(
    "gmail_refresh",
    { title: "Refresh Gmail", description: "Check Gmail for new mail now instead of waiting for the next 2-minute poll.", inputSchema: {} },
    () =>
      safe(async () => {
        ctx.syncNow();
        return { ok: true };
      })
  );
}
