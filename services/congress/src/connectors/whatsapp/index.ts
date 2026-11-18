import { Hono } from "hono";
import { defineConnector } from "../contract.js";
import { closeWhatsappDb, runWhatsappMigrations } from "./db/client.js";
import { MIN_OWNER_MESSAGES, NEW_CONTACT_EVENT, syncWhatsapp } from "./cache.js";
import { readerGet, readerStartPairing } from "./readerClient.js";
import { registerWhatsappTools } from "./tools.js";

// WhatsApp, read-only forever: nothing is ever sent or uploaded to WhatsApp.
// Chats aren't records in Congress (they belong to WhatsApp); the AI reads
// them through its whatsapp_* tools, and new direct contacts go to the linker.
export const whatsappConnector = defineConnector({
  name: "whatsapp",
  label: "WhatsApp",
  source: [],
  events: [
    {
      type: NEW_CONTACT_EVENT,
      label: "New WhatsApp contact",
      description: `A 1:1 chat where you wrote at least ${MIN_OWNER_MESSAGES} times and no Person has the number yet; the AI decides whether to make one.`,
      payloadFields: { jid: { type: "string" }, phone: { type: "string" }, name: { type: "string" }, ownerMessages: { type: "number" } },
    },
  ],
  start: () => runWhatsappMigrations(),
  stop: () => closeWhatsappDb(),
  sync: (ctx) => syncWhatsapp(ctx),
  intervalMs: () => 2 * 60_000,
  read: { get: () => null, list: () => [] },
  // Setup panel: link status and QR pairing only.
  routes() {
    const app = new Hono();
    app.get("/status", () => readerGet("/status"));
    app.get("/pairing", () => readerGet("/pairing"));
    app.post("/pairing", () => readerStartPairing());
    return app;
  },
  tools: (_ctx, server) => registerWhatsappTools(server),
});
