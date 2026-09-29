import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { findChats, listChats, listUnread, markReadLocally, readChat, readerStatus, searchMessages } from "../aiRead.js";

// Read-only WhatsApp tools for Congress's AI. Nothing here can send, react,
// send read receipts or download media; mark_read only changes Congress's own copy.

async function run(fn: () => Promise<unknown>) {
  try {
    return textResult(await fn());
  } catch (err) {
    return { ...textResult({ error: (err as Error).message }), isError: true };
  }
}

const jidSchema = z.string().min(3).describe("Chat id (jid) from list_chats, find_chats or search_messages.");

export const TOOL_NAMES = ["get_status", "list_chats", "find_chats", "read_chat", "search_messages", "list_unread", "mark_read"] as const;

const LOCAL_READ =
  "Unread = incoming messages not yet read on the owner's phone, another WhatsApp device, or in Congress. Congress's read state is local: WhatsApp and the senders are never told.";

export function registerTools(server: McpServer) {
  server.registerTool(
    "get_status",
    {
      title: "WhatsApp Status",
      description:
        "Whether the WhatsApp reader is linked and connected, and when the owner's phone was last seen (linked devices are dropped after ~14 days without the phone). Read-only.",
      inputSchema: {},
    },
    async () => run(() => readerStatus())
  );

  server.registerTool(
    "list_chats",
    {
      title: "List WhatsApp Chats",
      description:
        "The owner's WhatsApp chats, most recent activity first, with the last message and unread count. Pass nextCursor back as cursor for older chats. Read-only.",
      inputSchema: {
        limit: z.number().int().positive().max(200).default(30),
        cursor: z.string().optional(),
      },
    },
    async ({ limit, cursor }) => run(() => listChats(limit, cursor))
  );

  server.registerTool(
    "find_chats",
    {
      title: "Find WhatsApp Chats",
      description: "Find chats by contact or group name (or part of a phone number). Read-only.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => run(() => findChats(query))
  );

  server.registerTool(
    "read_chat",
    {
      title: "Read WhatsApp Chat",
      description:
        "Messages of one chat, oldest-first within the page, ending at the newest (or just before `before`). Pass olderCursor back as `before` to read further back. Unread messages carry `unread: true`. Attachments are described, not downloaded. Read-only: reading doesn't mark anything read (use mark_read).",
      inputSchema: {
        jid: jidSchema,
        limit: z.number().int().positive().max(200).default(50),
        before: z.string().optional().describe("olderCursor from a previous read_chat call."),
        unreadOnly: z.boolean().default(false).describe("Only unread messages."),
      },
    },
    async ({ jid, limit, before, unreadOnly }) => run(() => readChat(jid, limit, before, unreadOnly))
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search WhatsApp Messages",
      description:
        "Full-text search across message text (every word must match; prefixes match), newest first, optionally within one chat. Use read_chat with the jid to see context. Read-only.",
      inputSchema: {
        query: z.string().min(1),
        jid: jidSchema.optional().describe("Only this chat."),
        limit: z.number().int().positive().max(100).default(30),
      },
    },
    async ({ query, jid, limit }) => run(() => searchMessages(query, jid, limit))
  );

  server.registerTool(
    "list_unread",
    {
      title: "List Unread WhatsApp Messages",
      description: `Chats with unread messages (or marked unread on the phone), most recent first, each with its newest unread messages oldest-first, plus totals. ${LOCAL_READ} Read-only.`,
      inputSchema: {
        limit: z.number().int().positive().max(100).default(20).describe("Chats per page."),
        messagesPerChat: z.number().int().min(0).max(100).default(20),
        cursor: z.string().optional().describe("nextCursor from a previous call."),
      },
    },
    async ({ limit, messagesPerChat, cursor }) => run(() => listUnread(limit, messagesPerChat, cursor))
  );

  server.registerTool(
    "mark_read",
    {
      title: "Mark WhatsApp Chat Read (in Congress)",
      description: `Marks a chat's messages read in Congress only, up to and including upToMessageId (default: all). ${LOCAL_READ} No blue ticks; the phone still shows them unread. Use after the owner has seen them, e.g. once you've summarised them to the owner.`,
      inputSchema: {
        jid: jidSchema,
        upToMessageId: z.string().optional().describe("Message id from read_chat or list_unread."),
      },
    },
    async ({ jid, upToMessageId }) => run(() => markReadLocally(jid, upToMessageId))
  );
}
