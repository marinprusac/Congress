import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchBlockedError, htmlToText, isPrivateAddress, parseHttpUrl, safeFetch } from "./safeFetch.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/page") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>Hi</title><p>Hello &amp; welcome</p>");
    if (path === "/redirect") return void res.writeHead(302, { location: "/page" }).end();
    if (path === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (path === "/big") return void res.writeHead(200, { "content-type": "text/plain" }).end("x".repeat(5000));
    if (path === "/image") return void res.writeHead(200, { "content-type": "image/png" }).end("png");
    if (path === "/slow") return; // never answers
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"])(
    "treats %s as private",
    (addr) => expect(isPrivateAddress(addr)).toBe(true)
  );
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"])("treats %s as public", (addr) => expect(isPrivateAddress(addr)).toBe(false));
});

describe("parseHttpUrl", () => {
  it("accepts only plain http(s) URLs", () => {
    expect(parseHttpUrl("https://example.com/a").hostname).toBe("example.com");
    for (const bad of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "not a url"]) {
      expect(() => parseHttpUrl(bad)).toThrow(FetchBlockedError);
    }
  });
});

describe("safeFetch", () => {
  it("refuses private literals and names that resolve to loopback", async () => {
    await expect(safeFetch(`${base}/page`)).rejects.toThrow(/private/);
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private/);
    await expect(safeFetch("http://[::1]/")).rejects.toThrow(/private/);
    await expect(safeFetch(`http://localhost:${new URL(base).port}/page`)).rejects.toThrow(/private/);
  });

  it("reads a page and follows relative redirects", async () => {
    const res = await safeFetch(`${base}/redirect`, { allowPrivate: true });
    expect(res).toMatchObject({ status: 200, contentType: "text/html", url: `${base}/page`, truncated: false });
    expect(htmlToText(res.body)).toEqual({ title: "Hi", text: "Hello & welcome" });
  });

  it("stops redirect loops", async () => {
    await expect(safeFetch(`${base}/loop`, { allowPrivate: true, maxRedirects: 3 })).rejects.toThrow(/redirects/);
  });

  it("truncates at the size cap", async () => {
    const res = await safeFetch(`${base}/big`, { allowPrivate: true, maxBytes: 1000 });
    expect(res.body).toHaveLength(1000);
    expect(res.truncated).toBe(true);
  });

  it("refuses non-text content", async () => {
    await expect(safeFetch(`${base}/image`, { allowPrivate: true })).rejects.toThrow(/Unsupported content type/);
  });

  it("times out", async () => {
    await expect(safeFetch(`${base}/slow`, { allowPrivate: true, timeoutMs: 100 })).rejects.toThrow(/Timed out/);
  });
});

describe("htmlToText", () => {
  it("drops scripts, styles and comments and keeps paragraph breaks", () => {
    const { text } = htmlToText("<style>p{}</style><script>evil()</script><!-- c --><p>One</p><p>Two &#33;</p>");
    expect(text).toBe("One\nTwo !");
  });
});
