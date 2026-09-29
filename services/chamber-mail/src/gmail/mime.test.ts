import { describe, expect, it } from "vitest";
import { categoryOf, collectParts, decodeBase64Url, htmlToText, parseAddress, stripQuoted, type GmailPart } from "./mime.js";

const b64 = (s: string, enc: BufferEncoding = "utf8") => Buffer.from(s, enc).toString("base64url");

describe("parseAddress", () => {
  it("splits name and address", () => {
    expect(parseAddress('"Doe, Jane" <jane@example.com>')).toEqual({ name: "Doe, Jane", email: "jane@example.com" });
    expect(parseAddress("jane@example.com")).toEqual({ name: null, email: "jane@example.com" });
    expect(parseAddress("<jane@example.com>")).toEqual({ name: null, email: "jane@example.com" });
    expect(parseAddress(undefined)).toEqual({ name: null, email: null });
  });
});

describe("collectParts", () => {
  const payload: GmailPart = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { partId: "0.0", mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' }], body: { data: b64("café", "latin1") } },
          { partId: "0.1", mimeType: "text/html", body: { attachmentId: "big-html", size: 90000 } },
        ],
      },
      { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att-1", size: 1234 } },
      {
        partId: "2",
        mimeType: "text/plain",
        headers: [{ name: "Content-Disposition", value: "attachment" }],
        body: { attachmentId: "att-2", size: 10 },
      },
    ],
  };

  it("finds the first plain and html bodies, including split-off ones", () => {
    const { text, html } = collectParts(payload);
    expect(text).toMatchObject({ mimeType: "text/plain", charset: "iso-8859-1" });
    expect(decodeBase64Url(text!.data!, text!.charset)).toBe("café");
    expect(html).toMatchObject({ mimeType: "text/html", attachmentId: "big-html" });
  });

  it("treats filenames and attachment dispositions as attachments", () => {
    expect(collectParts(payload).attachments).toEqual([
      { partId: "1", filename: "invoice.pdf", mimeType: "application/pdf", size: 1234, attachmentId: "att-1" },
      { partId: "2", filename: "attachment", mimeType: "text/plain", size: 10, attachmentId: "att-2" },
    ]);
  });

  it("handles a single-part message", () => {
    const { text, attachments } = collectParts({ mimeType: "text/plain", body: { data: b64("hi") } });
    expect(decodeBase64Url(text!.data!)).toBe("hi");
    expect(attachments).toEqual([]);
  });

  it("falls back to utf-8 for an unknown charset", () => {
    expect(decodeBase64Url(b64("ok"), "x-made-up")).toBe("ok");
  });
});

describe("htmlToText", () => {
  it("keeps structure and links, drops styles and scripts", () => {
    const html = `<html><head><style>p{color:red}</style></head><body>
      <p>Hi&nbsp;Marin,</p><p>Your order <b>#42</b> shipped.</p>
      <ul><li>One</li><li>Two</li></ul>
      <a href="https://track.example/42">Track it</a><br>Thanks &amp; bye<script>alert(1)</script>
      <!-- hidden --></body></html>`;
    expect(htmlToText(html)).toBe("Hi Marin,\n\nYour order #42 shipped.\n\n• One\n• Two\n\nTrack it (https://track.example/42)\nThanks & bye");
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("&#8364;5 &#x2014; &lt;ok&gt;")).toBe("€5 — <ok>");
  });
});

describe("stripQuoted", () => {
  it("cuts the quoted history of a reply", () => {
    const text = "Sounds good!\n\nOn Mon, 28 Sep 2026 at 10:00, Jane <jane@example.com> wrote:\n> Shall we meet?\n> -- Jane";
    expect(stripQuoted(text)).toBe("Sounds good!");
  });

  it("handles an attribution wrapped over two lines", () => {
    expect(stripQuoted("Yes.\nOn Mon, 28 Sep 2026 at 10:00, Jane Doe\n<jane@example.com> wrote:\n> old")).toBe("Yes.");
  });

  it("leaves plain text alone", () => {
    expect(stripQuoted("Line one\nLine two")).toBe("Line one\nLine two");
  });
});

describe("categoryOf", () => {
  it("maps Gmail category labels", () => {
    expect(categoryOf(["INBOX", "CATEGORY_PROMOTIONS"])).toBe("promotions");
    expect(categoryOf(["INBOX", "CATEGORY_PERSONAL"])).toBe("primary");
    expect(categoryOf(["INBOX"])).toBe("primary");
  });
});
