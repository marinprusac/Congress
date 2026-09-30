import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ConnectorContext } from "../contract.js";
import { setReaderSocket } from "./readerClient.js";
import { runWhatsappMigrations, whatsappDb } from "./db/client.js";
import { chatRecord, getChatRow, peopleToCreate, phoneOf, setCreatePeople, syncWhatsapp } from "./cache.js";
import { whatsappConnector } from "./index.js";

const ANA = "385911111111@s.whatsapp.net";
const BOB = "385922222222@s.whatsapp.net";
const GROUP = "123-456@g.us";
const T = Date.UTC(2026, 8, 30, 12);

const chats = [
  { jid: ANA, name: "Ana", isGroup: false, lastMessageAt: T, lastText: "see you", lastFromMe: false, unreadCount: 2 },
  { jid: BOB, name: "Bob", isGroup: false, lastMessageAt: T - 1000, lastText: "hi", lastFromMe: false, unreadCount: 0 },
  { jid: GROUP, name: "Climbing", isGroup: true, lastMessageAt: T - 2000, lastText: "ok", lastFromMe: false, lastSender: "Eve", unreadCount: 0 },
];
// Only in Ana's chat did the owner write enough; Bob got a single reply.
const mine = (n: number) => Array.from({ length: n }, () => ({ fromMe: true }));
const messages: Record<string, { fromMe: boolean }[]> = { [ANA]: [{ fromMe: false }, ...mine(5)], [BOB]: [{ fromMe: false }, ...mine(1)] };
const requests: string[] = [];
let server: Server;

beforeAll(async () => {
  const socket = join(mkdtempSync(join(tmpdir(), "wa-conn-")), "api.sock");
  setReaderSocket(socket);
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? "/", "http://x");
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const m = url.pathname.match(/^\/chats\/([^/]+)(\/messages|\/read)?$/);
    if (url.pathname === "/chats") return json({ chats, nextCursor: "" });
    if (m?.[2] === "/messages") return json({ messages: messages[decodeURIComponent(m[1]!)] ?? [], nextCursor: "" });
    if (m?.[2] === "/read" && req.method === "POST") return json({ ...chats[0], unreadCount: 0 });
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(socket, r));
  runWhatsappMigrations();
});

afterAll(() => server.close());

const resolved: string[] = [];
const found: string[] = [];
const emitted: { key: string; quiet: boolean }[] = [];
const ctx = {
  people: {
    find: (k: string | { phone?: string }) => (found.push(typeof k === "string" ? k : (k.phone ?? "")), null),
    resolve: (input: { phone?: string }) => (resolved.push(input.phone ?? ""), `person-${input.phone}`),
  },
  emitChange: (_kind: string, key: string, _deleted?: boolean, quiet = false) => emitted.push({ key, quiet }),
} as unknown as ConnectorContext;

beforeEach(() => {
  resolved.length = 0;
  found.length = 0;
  emitted.length = 0;
});

describe("the WhatsApp connector's chats", () => {
  it("reads phone numbers only from 1:1 phone chats", () => {
    expect(phoneOf(ANA)).toBe("+385911111111");
    expect(phoneOf(GROUP)).toBeNull();
    expect(phoneOf("12345@lid")).toBeNull();
  });

  it("keeps every chat, quietly, and only links People until creation is allowed", async () => {
    expect(await syncWhatsapp(ctx)).toEqual({ changed: 3, error: null });
    expect(emitted.every((e) => e.quiet)).toBe(true);
    expect(resolved).toEqual([]);
    expect(found.sort()).toEqual(["+385911111111", "+385922222222"]);
    expect(chatRecord(getChatRow(ANA)!).values).toMatchObject({ name: "Ana", preview: "see you", unread: 2, hasUnread: true, phone: "+385911111111", people: [] });
    expect(chatRecord(getChatRow(GROUP)!).values).toMatchObject({ preview: "Eve: ok", isGroup: true, phone: "" });
    expect(peopleToCreate().map((c) => c.jid)).toEqual([ANA]);
  });

  it("creates a Person only for the 1:1 chat the owner wrote in at least five times", async () => {
    setCreatePeople(true);
    await syncWhatsapp(ctx);
    expect(resolved).toEqual(["+385911111111"]);
    expect(getChatRow(ANA)?.personId).toBe("person-+385911111111");
    expect(getChatRow(BOB)?.personId).toBeNull();
    expect(emitted.map((e) => e.key)).toEqual([ANA]);
  });

  it("marks read only in the reader, never telling WhatsApp", async () => {
    const rec = await whatsappConnector.push!.act(ctx, "chat", ANA, "markReadLocally", {});
    expect(rec.values).toMatchObject({ unread: 0, hasUnread: false });
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([`POST /chats/${encodeURIComponent(ANA)}/read`]);
    whatsappDb.run(sql`delete from chats`);
  });
});
