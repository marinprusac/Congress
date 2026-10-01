import { Hono } from "hono";
import { ConnectorRefusedError, defineConnector } from "../contract.js";
import { closeWhatsappDb, runWhatsappMigrations } from "./db/client.js";
import { chatRecord, getChatRow, getWhatsappSettings, listChatRows, MIN_OWNER_MESSAGES, peopleToCreate, setCreatePeople, storeChat, syncWhatsapp, type ReaderChat } from "./cache.js";
import { readerGet, readerJson, readerMarkReadLocally, readerPath, readerStartPairing } from "./readerClient.js";
import { readChat } from "./aiRead.js";
import { registerWhatsappTools } from "./tools.js";

// WhatsApp, read-only forever: nothing is ever sent or uploaded to WhatsApp.
// There is no push here apart from marking a chat read in the reader's own DB.
const refuse = () => Promise.reject(new ConnectorRefusedError("WhatsApp is read-only: nothing is ever sent to it"));
const seg = (s: string) => encodeURIComponent(s);

export const whatsappConnector = defineConnector({
  name: "whatsapp",
  label: "WhatsApp",
  source: [
    {
      kind: "chat",
      label: "Chat",
      fields: [
        { slug: "name", kind: "text", label: "Name" },
        { slug: "lastAt", kind: "datetime", label: "Last message" },
        { slug: "preview", kind: "text", label: "Last message text" },
        { slug: "unread", kind: "number", label: "Unread" },
        { slug: "hasUnread", kind: "boolean", label: "Has unread" },
        { slug: "muted", kind: "boolean", label: "Muted" },
        { slug: "lastFromMe", kind: "boolean", label: "Last from you" },
        { slug: "isGroup", kind: "boolean", label: "Group" },
        { slug: "phone", kind: "text", label: "Phone" },
        { slug: "people", kind: "relation", label: "People", many: true, target: "person" },
      ],
      facts: [{ slug: "hasUnread", label: "Has unread" }],
    },
  ],
  start: () => runWhatsappMigrations(),
  stop: () => closeWhatsappDb(),
  sync: (ctx) => syncWhatsapp(ctx),
  intervalMs: () => 2 * 60_000,
  read: {
    get(kind, key) {
      const row = kind === "chat" ? getChatRow(key) : undefined;
      return row ? chatRecord(row) : null;
    },
    list: (kind) => (kind === "chat" ? listChatRows().map(chatRecord) : []),
    // For the AI: the newest messages, oldest first (the chat page reads the reader itself).
    detail: (_ctx, _kind, key, opts) => readChat(key, Math.min(Number(opts.limit) || 50, 200), opts.before),
    async search(_ctx, _kind, query, limit) {
      const r = await readerJson<{ chats: ReaderChat[] }>(readerPath("/search", { q: query, limit: String(limit) }, ["q", "limit"]));
      return r.chats.map((c) => {
        storeChat(c);
        return chatRecord(getChatRow(c.jid)!);
      });
    },
  },
  push: {
    create: refuse,
    update: refuse,
    delete: refuse,
    // Local only: the reader's own DB. WhatsApp and the sender are never told.
    async act(ctx, kind, key, action) {
      if (kind !== "chat" || action !== "markReadLocally") throw new ConnectorRefusedError(`no action "${action}"`);
      storeChat(await readerJson<ReaderChat>(readerMarkReadLocally(key)));
      ctx.emitChange("chat", key, false, true);
      return chatRecord(getChatRow(key)!);
    },
  },
  // The Chats view's API: the reader's GET routes as the Chamber served them, pairing, and local mark-read.
  routes(ctx) {
    const app = new Hono();
    const settingsDto = () => ({ createPeople: getWhatsappSettings().createPeople, minOwnerMessages: MIN_OWNER_MESSAGES, pending: peopleToCreate().length });
    app.get("/settings", (c) => c.json(settingsDto()));
    app.put("/settings", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { createPeople?: unknown };
      if (typeof body.createPeople !== "boolean") return c.json({ error: "createPeople must be a boolean" }, 400);
      setCreatePeople(body.createPeople);
      return c.json(settingsDto());
    });
    app.get("/status", () => readerGet("/status"));
    app.get("/pairing", () => readerGet("/pairing"));
    app.post("/pairing", () => readerStartPairing());
    app.get("/chats", (c) => readerGet(readerPath("/chats", c.req.query(), ["cursor", "limit"])));
    app.get("/chats/:jid", (c) => readerGet(`/chats/${seg(c.req.param("jid"))}`));
    app.get("/chats/:jid/record", (c) => c.json({ id: ctx.records.idFor("chat", c.req.param("jid")) }));
    app.get("/chats/:jid/messages", (c) => readerGet(readerPath(`/chats/${seg(c.req.param("jid"))}/messages`, c.req.query(), ["cursor", "limit", "unread"])));
    app.post("/chats/:jid/read", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { upTo?: unknown };
      const upTo = typeof body.upTo === "string" && body.upTo ? body.upTo : undefined;
      const res = await readerMarkReadLocally(c.req.param("jid"), upTo);
      if (!res.ok) return res;
      const chat = (await res.json()) as ReaderChat;
      if (storeChat(chat)) ctx.emitChange("chat", chat.jid, false, true);
      return Response.json(chat);
    });
    app.get("/unread", (c) => readerGet(readerPath("/unread", c.req.query(), ["cursor", "limit", "messages"])));
    app.get("/search", (c) => readerGet(readerPath("/search", c.req.query(), ["q", "chat", "limit"])));
    app.get("/media/:chat/:id", (c) => readerGet(`/media/${seg(c.req.param("chat"))}/${seg(c.req.param("id"))}`, 120_000));
    return app;
  },
  tools: (_ctx, server) => registerWhatsappTools(server),
});
