import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { readerGet, readerMarkReadLocally, readerPath, readerStartPairing } from "./readerClient.js";

// Read-only proxy to wa-reader (GET, plus POST /api/pairing to link and a
// local-only mark-read). No feed
// or exhibits yet; the AI reads through src/mcp/tools.ts.
export const app = new Hono<{ Bindings: HttpBindings }>();

const seg = (s: string) => encodeURIComponent(s);

app.get("/api/status", () => readerGet("/status"));

// Linking this device from the app: start a QR session, then poll it.
app.get("/api/pairing", () => readerGet("/pairing"));
app.post("/api/pairing", () => readerStartPairing());

app.get("/api/chats", (c) => readerGet(readerPath("/chats", c.req.query(), ["cursor", "limit"])));

app.get("/api/chats/:jid", (c) => readerGet(`/chats/${seg(c.req.param("jid"))}`));

app.get("/api/chats/:jid/messages", (c) =>
  readerGet(readerPath(`/chats/${seg(c.req.param("jid"))}/messages`, c.req.query(), ["cursor", "limit", "unread"]))
);

// Marks a chat read in wa-reader's DB only; no read receipt reaches WhatsApp.
app.post("/api/chats/:jid/read", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { upTo?: unknown };
  const upTo = typeof body.upTo === "string" && body.upTo ? body.upTo : undefined;
  return readerMarkReadLocally(c.req.param("jid"), upTo);
});

app.get("/api/unread", (c) => readerGet(readerPath("/unread", c.req.query(), ["cursor", "limit", "messages"])));

app.get("/api/search", (c) => readerGet(readerPath("/search", c.req.query(), ["q", "chat", "limit"])));

app.get("/api/media/:chat/:id", (c) =>
  readerGet(`/media/${seg(c.req.param("chat"))}/${seg(c.req.param("id"))}`, 120_000)
);
