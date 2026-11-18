import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ConnectorContext } from "../contract.js";
import { setReaderSocket } from "./readerClient.js";
import { runWhatsappMigrations, whatsappDb } from "./db/client.js";
import { getChatRow, NEW_CONTACT_EVENT, phoneOf, syncWhatsapp } from "./cache.js";
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
const published: { type: string; payload: Record<string, unknown> }[] = [];
const emitted: string[] = [];
const people: Record<string, string> = {};
const ctx = {
  people: {
    find: (k: string | { phone?: string }) => people[typeof k === "string" ? k : (k.phone ?? "")] ?? null,
    resolve: (input: { phone?: string }) => (resolved.push(input.phone ?? ""), `person-${input.phone}`),
  },
  publish: (type: string, payload: Record<string, unknown>) => published.push({ type, payload }),
  emitChange: (_kind: string, key: string) => emitted.push(key),
} as unknown as ConnectorContext;

beforeEach(() => {
  whatsappDb.run(sql`delete from chats`);
  resolved.length = 0;
  published.length = 0;
  emitted.length = 0;
  for (const k of Object.keys(people)) delete people[k];
});

describe("the WhatsApp connector", () => {
  it("reads phone numbers only from 1:1 phone chats", () => {
    expect(phoneOf(ANA)).toBe("+385911111111");
    expect(phoneOf(GROUP)).toBeNull();
    expect(phoneOf("12345@lid")).toBeNull();
  });

  it("makes no records and no People; offers the AI a direct contact once", async () => {
    expect(await syncWhatsapp(ctx)).toEqual({ changed: 3, error: null });
    expect(emitted).toEqual([]);
    expect(resolved).toEqual([]);
    expect(published).toEqual([{ type: NEW_CONTACT_EVENT, payload: { jid: ANA, phone: "+385911111111", name: "Ana", ownerMessages: 5 } }]);
    expect(getChatRow(ANA)?.contactQueuedAt).toBeInstanceOf(Date);
    expect(getChatRow(BOB)?.contactQueuedAt).toBeNull();
    await syncWhatsapp(ctx);
    expect(published).toHaveLength(1);
  });

  it("doesn't offer a contact a Person already has the number of", async () => {
    people["+385911111111"] = "person-ana";
    await syncWhatsapp(ctx);
    expect(published).toEqual([]);
    expect(getChatRow(ANA)?.contactQueuedAt).toBeInstanceOf(Date);
  });

  it("serves only status and pairing, and never POSTs to the reader on sync", async () => {
    requests.length = 0;
    await syncWhatsapp(ctx);
    expect(requests.filter((r) => r.startsWith("POST"))).toEqual([]);
    const app = whatsappConnector.routes!(ctx);
    expect((await app.request("/chats")).status).toBe(404);
    expect(whatsappConnector.push).toBeUndefined();
    expect(whatsappConnector.source).toEqual([]);
  });
});
