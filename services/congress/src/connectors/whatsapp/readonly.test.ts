import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorRefusedError, type ConnectorContext } from "../contract.js";
import { whatsappConnector } from "./index.js";

// Nothing may ever be sent or uploaded to WhatsApp (a permanent owner rule).
// The Go reader guards itself (tests/wa-reader-readonly.test.ts); this guards
// the connector: its only writes are pairing and marking read in the reader's own DB.

const dir = __dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const text = (f: string) => readFileSync(join(dir, f), "utf8");

describe("the WhatsApp connector stays read-only", () => {
  it("POSTs to the reader only to pair and to mark read locally", () => {
    const posts = [...text("readerClient.ts").matchAll(/readerRequest\("POST", ([^,]+)/g)].map((m) => m[1]);
    expect(posts).toEqual(['"/pairing"', "`/chats/${encodeURIComponent(jid)}/read`"]);
  });

  it("talks to the reader only through readerClient", () => {
    const offenders = sources.filter((f) => f !== "readerClient.ts" && /readerRequest\(|socketPath|method:\s*["'](POST|PUT|PATCH|DELETE)/.test(text(f)));
    expect(offenders).toEqual([]);
  });

  it("refuses every push but a local mark-read", async () => {
    const ctx = {} as ConnectorContext;
    const push = whatsappConnector.push!;
    await expect(push.create(ctx, "chat", {})).rejects.toThrow(ConnectorRefusedError);
    await expect(push.update(ctx, "chat", "x@s.whatsapp.net", { name: "x" })).rejects.toThrow(ConnectorRefusedError);
    await expect(push.delete(ctx, "chat", "x@s.whatsapp.net")).rejects.toThrow(ConnectorRefusedError);
    await expect(push.act(ctx, "chat", "x@s.whatsapp.net", "send", {})).rejects.toThrow(ConnectorRefusedError);
  });
});
