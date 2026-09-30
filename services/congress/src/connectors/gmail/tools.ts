import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult } from "../../kit/mcp.js";
import type { ConnectorContext } from "../contract.js";
import { listLabels } from "./api.js";
import { mailboxSummary, readAttachmentText } from "./detail.js";

async function safe(fn: () => Promise<unknown>) {
  try {
    return mcpTextResult(await fn());
  } catch (err) {
    return mcpTextResult({ error: (err as Error).message });
  }
}

// Gmail tools that aren't about one email record (those are the generic *_email tools).
export function registerGmailTools(ctx: ConnectorContext, server: McpServer): void {
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
      description: "The text of a text-like attachment (read_email lists each message's attachments with accountId in its key \"<accountId>:<threadId>\", messageId and partId). Binary files only report metadata.",
      inputSchema: { accountId: z.number().int(), messageId: z.string().min(1), partId: z.string().min(1) },
    },
    ({ accountId, messageId, partId }) => safe(() => readAttachmentText(ctx, accountId, messageId, partId))
  );

  server.registerTool(
    "gmail_list_labels",
    { title: "List Gmail labels", description: "An account's Gmail labels (for search_all_emails queries like label:x).", inputSchema: { accountId: z.number().int() } },
    ({ accountId }) => safe(() => listLabels(ctx, accountId))
  );

  server.registerTool(
    "gmail_refresh",
    { title: "Refresh Gmail", description: "Sync Gmail now instead of waiting for the next 2-minute poll.", inputSchema: {} },
    () =>
      safe(async () => {
        ctx.syncNow();
        return { ok: true };
      })
  );
}
