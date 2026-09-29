import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpTextResult as textResult } from "@congress/chamber-kit";
import { findChats, listChats, readChat, readerStatus, searchMessages } from "../aiRead.js";

// Read-only WhatsApp tools for Congress's AI. Nothing here can send, react,
// mark read or download media.

async function run(fn: () => Promise<unknown>) {
  try {
    return textResult(await fn());
  } catch (err) {
    return { ...textResult({ error: (err as Error).message }), isError: true };
  }
}

const jidSchema = z.string().min(3).describe("Chat id (jid) from list_chats, find_chats or search_messages.");

export const TOOL_NAMES = ["get_status", "list_chats", "find_chats", "read_chat", "search_messages"] as const;

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
        "The owner's WhatsApp chats, most recent activity first, with the last message. Pass nextCursor back as cursor for older chats. Read-only.",
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
        "Messages of one chat, oldest-first within the page, ending at the newest (or just before `before`). Pass olderCursor back as `before` to read further back. Attachments are described, not downloaded. Read-only: nothing is marked read.",
      inputSchema: {
        jid: jidSchema,
        limit: z.number().int().positive().max(200).default(50),
        before: z.string().optional().describe("olderCursor from a previous read_chat call."),
      },
    },
    async ({ jid, limit, before }) => run(() => readChat(jid, limit, before))
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
}
