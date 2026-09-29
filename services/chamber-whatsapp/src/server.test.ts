import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initEnv } from "./env.js";
import { app } from "./server.js";

// A fake wa-reader on a real Unix socket.
const socket = join(mkdtempSync(join(tmpdir(), "wa-reader-")), "api.sock");
const seen: { method: string; url: string }[] = [];
let server: Server;

beforeAll(async () => {
  initEnv({ WA_READER_SOCKET: socket });
  server = createServer((req: IncomingMessage, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "" });
    if (req.url?.startsWith("/media/")) {
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Set-Cookie": "leak=1",
      });
      res.end("JPEG");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(socket, r));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (path: string, init?: RequestInit) => app.request(`http://whatsapp.chamber${path}`, init);

describe("WhatsApp Chamber proxy", () => {
  it("relays chats and messages with only whitelisted query params, encoding JIDs", async () => {
    seen.length = 0;
    expect((await get("/api/chats?limit=20&cursor=1%7Cx&evil=1")).status).toBe(200);
    await get(`/api/chats/${encodeURIComponent("385911111111@s.whatsapp.net")}/messages?cursor=5%7Ca`);
    await get("/api/search?q=hi%20there&chat=g%40g.us&admin=true");
    expect(seen.map((s) => s.url)).toEqual([
      "/chats?cursor=1%7Cx&limit=20",
      "/chats/385911111111%40s.whatsapp.net/messages?cursor=5%7Ca",
      "/search?q=hi+there&chat=g%40g.us",
    ]);
    expect(seen.every((s) => s.method === "GET")).toBe(true);
  });

  it("streams media and drops headers it doesn't know", async () => {
    const res = await get("/api/media/a%40s.whatsapp.net/ABC");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("JPEG");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("offers no way to write", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await get("/api/chats", { method })).status).toBe(404);
    }
  });

  it("reports the daemon as unavailable when its socket is gone", async () => {
    initEnv({ WA_READER_SOCKET: join(tmpdir(), "no-such-wa-reader.sock") });
    const res = await get("/api/status");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "reader_unavailable" });
    initEnv({ WA_READER_SOCKET: socket });
  });
});
