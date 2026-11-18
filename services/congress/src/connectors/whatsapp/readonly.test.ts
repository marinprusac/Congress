import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("has no push at all: chats aren't records", () => {
    expect(whatsappConnector.push).toBeUndefined();
  });
});
