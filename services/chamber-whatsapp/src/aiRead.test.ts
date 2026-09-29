import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initEnv } from "./env.js";
import { findChats, formatMessage, listChats, listUnread, markReadLocally, readChat, searchMessages } from "./aiRead.js";
import { registerTools, TOOL_NAMES } from "./mcp/tools.js";

const ANA = "385911111111@s.whatsapp.net";
const msg = (over: Record<string, unknown>) => ({
  chatJid: ANA, id: "1", senderJid: ANA, senderName: "Ana", fromMe: false, ts: Date.UTC(2026, 8, 29, 12), type: "text",
  text: "hi", quoted: null, editedAt: null, revokedAt: null, media: null, reactions: [], ...over,
});

// A fake wa-reader on a real Unix socket.
const socket = join(mkdtempSync(join(tmpdir(), "wa-ai-")), "api.sock");
const urls: string[] = [];
const bodies: string[] = [];
let server: Server;
beforeAll(async () => {
  initEnv({ WA_READER_SOCKET: socket });
  server = createServer(async (req, res) => {
    urls.push(`${req.method} ${req.url}`);
    let body = "";
    for await (const chunk of req) body += chunk;
    if (body) bodies.push(body);
    const url = req.url ?? "";
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.startsWith("/chats/nobody")) return json(404, { error: "chat_not_found" });
    if (req.method === "POST" && url.endsWith("/read")) {
      return json(200, { jid: ANA, name: "Ana Horvat", isGroup: false, lastMessageAt: 0, unreadCount: 1, markedUnread: false });
    }
    if (url.startsWith("/unread")) {
      return json(200, {
        chats: [{ jid: ANA, name: "Ana Horvat", isGroup: false, lastMessageAt: 0, lastText: "b", lastType: "text", unreadCount: 3, markedUnread: false,
          messages: [msg({ id: "b", text: "b", unread: true }), msg({ id: "a", text: "a", unread: true })] }],
        totalMessages: 3, totalChats: 1, nextCursor: "",
      });
    }
    if (url.includes("/messages")) {
      return json(200, { messages: [msg({ id: "2", text: "second", ts: Date.UTC(2026, 8, 29, 13) }), msg({ id: "1" })], nextCursor: "5|a" });
    }
    if (url.startsWith("/chats/")) return json(200, { jid: ANA, name: "Ana Horvat", isGroup: false, lastMessageAt: 0 });
    if (url.startsWith("/chats")) {
      return json(200, { chats: [{ jid: "4930123456@s.whatsapp.net", name: "", isGroup: false, lastMessageAt: 0, lastText: "", lastType: "image", lastFromMe: true, lastSender: "", lastRevoked: false }], nextCursor: "" });
    }
    if (url.startsWith("/search")) return json(200, { chats: [], messages: [msg({ chatName: "Ana Horvat", text: "dinner friday" })] });
    json(404, { error: "nope" });
  });
  await new Promise<void>((r) => server.listen(socket, r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("WhatsApp reading for the AI", () => {
  it("formats deleted, edited, quoted, reacted and attachment messages without leaking deleted content", () => {
    expect(formatMessage(msg({ revokedAt: 1, text: "", media: null }) as never)).toEqual({
      id: "1", at: "2026-09-29T12:00:00.000Z", from: "Ana", deleted: true,
    });
    const m = formatMessage(msg({
      fromMe: true, type: "document", text: "invoice", editedAt: 5,
      media: { mimetype: "application/pdf", size: 96_000, filename: "inv.pdf" },
      quoted: { text: "send it?", type: "text", senderName: "Ana", senderJid: ANA, fromMe: false },
      reactions: [{ emoji: "👍", senderJid: "4930123456@s.whatsapp.net", senderName: "" }],
    }) as never);
    expect(m).toMatchObject({
      from: "You", text: "invoice", type: "document", attachment: 'document "inv.pdf" 94 KB', edited: true,
      replyTo: { from: "Ana", text: "send it?" }, reactions: ["👍 +4930123456"],
    });
  });

  it("reads a chat oldest-first with a cursor for older messages", async () => {
    const r = await readChat(ANA, 2);
    expect(r.chat.name).toBe("Ana Horvat");
    expect(r.messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(r.olderCursor).toBe("5|a");
    await readChat(ANA, 2, "5|a");
    expect(urls.at(-1)).toBe(`GET /chats/${encodeURIComponent(ANA)}/messages?limit=2&cursor=5%7Ca`);
  });

  it("lists, finds and searches, falling back to the number for unnamed chats", async () => {
    expect((await listChats(30)).chats[0]).toMatchObject({ name: "+4930123456", last: "You: [image]" });
    await findChats("ana");
    const s = await searchMessages("dinner", ANA, 10);
    expect(s.messages[0]).toMatchObject({ chat: "Ana Horvat", chatJid: ANA, text: "dinner friday" });
    expect(urls.filter((u) => u.includes("/search")).at(-1)).toBe(`GET /search?q=dinner&chat=${encodeURIComponent(ANA)}&limit=10`);
    expect(urls.every((u) => u.startsWith("GET "))).toBe(true);
  });

  it("lists unread messages oldest-first and says how many weren't shown", async () => {
    const r = await listUnread(20, 2);
    expect(urls.at(-1)).toBe("GET /unread?limit=20&messages=2");
    expect(r).toMatchObject({ totalUnreadMessages: 3, totalChats: 1, nextCursor: null });
    expect(r.chats[0]).toMatchObject({ name: "Ana Horvat", unread: 3, olderUnreadNotShown: 1 });
    expect(r.chats[0]?.messages.map((m) => [m.id, m.unread])).toEqual([["a", true], ["b", true]]);
    await readChat(ANA, 10, undefined, true);
    expect(urls.at(-1)).toBe(`GET /chats/${encodeURIComponent(ANA)}/messages?limit=10&unread=1`);
  });

  it("marks read only through the reader's local endpoint", async () => {
    bodies.length = 0;
    expect(await markReadLocally(ANA, "m9")).toEqual({ jid: ANA, unread: 1, markedUnread: false });
    expect(urls.at(-1)).toBe(`POST /chats/${encodeURIComponent(ANA)}/read`);
    expect(bodies).toEqual(['{"upTo":"m9"}']);
  });

  it("surfaces the reader's error code", async () => {
    await expect(readChat("nobody@s.whatsapp.net", 5)).rejects.toThrow("chat_not_found");
  });

  it("registers only the read tools", () => {
    const names: string[] = [];
    registerTools({ registerTool: (name: string) => names.push(name) } as unknown as McpServer);
    expect(names).toEqual([...TOOL_NAMES]);
    expect(names.filter((n) => /send|reply|react|upload|post|delete|edit/.test(n))).toEqual([]);
  });
});
