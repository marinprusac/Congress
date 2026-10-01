import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

// GET-only web fetch for the AI's internet mode. Refuses anything that
// resolves to a private, loopback or link-local address (checked in the
// socket's own DNS lookup, so a rebinding host can't swap it afterwards),
// follows a few redirects with the same checks, and caps time and size.

export class FetchBlockedError extends Error {}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  // Tests point this at a local server.
  allowPrivate?: boolean;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json|rss\+xml|atom\+xml))/i;

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

export function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("Only http(s) URLs can be fetched.");
  if (url.username || url.password) throw new FetchBlockedError("URLs with credentials are not allowed.");
  return url;
}

function requestOnce(url: URL, opts: Required<SafeFetchOptions>): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!opts.allowPrivate && isIP(host) && isPrivateAddress(host)) throw new FetchBlockedError("That address is private; refusing.");
  const lookup: typeof dnsLookup = ((hostname: string, options: unknown, cb: (...args: unknown[]) => void) => {
    const callback = (typeof options === "function" ? options : cb) as (...args: unknown[]) => void;
    const lookupOpts = typeof options === "function" ? {} : (options as object);
    dnsLookup(hostname, lookupOpts, (err, address, family) => {
      if (err) return callback(err);
      const list = Array.isArray(address) ? address : [{ address, family }];
      if (!opts.allowPrivate && list.some((a) => isPrivateAddress((a as { address: string }).address))) {
        return callback(new FetchBlockedError("That host resolves to a private address; refusing."));
      }
      if (Array.isArray(address)) callback(null, address);
      else callback(null, address, family);
    });
  }) as typeof dnsLookup;
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, { method: "GET", lookup, headers: { "user-agent": "CongressBot/1.0", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" } }, (res) =>
      resolve({ res, req })
    );
    req.setTimeout(opts.timeoutMs, () => req.destroy(new Error("Timed out.")));
    req.on("error", reject);
    req.end();
  });
}

async function readBody(res: http.IncomingMessage, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of res) {
    const buf = chunk as Buffer;
    if (size + buf.length > maxBytes) {
      chunks.push(buf.subarray(0, maxBytes - size));
      truncated = true;
      res.destroy();
      break;
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { timeoutMs: 10_000, maxBytes: 1_000_000, maxRedirects: 5, allowPrivate: false, ...options };
  let url = parseHttpUrl(raw);
  for (let hop = 0; ; hop++) {
    const { res } = await requestOnce(url, opts);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume();
      if (hop >= opts.maxRedirects) throw new FetchBlockedError("Too many redirects.");
      url = parseHttpUrl(new URL(location, url).toString());
      continue;
    }
    const contentType = String(res.headers["content-type"] ?? "");
    if (contentType && !TEXT_TYPES.test(contentType)) {
      res.destroy();
      throw new FetchBlockedError(`Unsupported content type (${contentType.split(";")[0]}); only text, HTML and JSON can be read.`);
    }
    const { text, truncated } = await readBody(res, opts.maxBytes);
    return { url: url.toString(), status, contentType: contentType.split(";")[0] ?? "", body: text, truncated };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Readable text from HTML: drops scripts/styles/markup, keeps line breaks.
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|head|title|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|ul|ol|table|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? htmlToText(title).text : null, text };
}
