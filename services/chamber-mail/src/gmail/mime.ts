// Pure helpers over Gmail's users.messages "full"/"metadata" payload shape.

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface RawGmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}

export interface AttachmentInfo {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
}

// A body part: inline data, or an attachmentId to fetch when Gmail split it off.
export interface BodyPart {
  mimeType: "text/plain" | "text/html";
  charset: string;
  data?: string;
  attachmentId?: string;
}

export type MailCategory = "primary" | "promotions" | "social" | "updates" | "forums";

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

export function parseAddress(value: string | undefined): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const trimmed = value.trim();
  const angle = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || null, email: angle[2]!.trim() };
  }
  return trimmed.includes("@") ? { name: null, email: trimmed } : { name: trimmed, email: null };
}

export function displayFrom(from: { name: string | null; email: string | null }): string {
  return from.name ?? from.email ?? "(unknown sender)";
}

function contentTypeParam(part: GmailPart, param: string): string | undefined {
  const ct = headerValue(part.headers, "Content-Type");
  const match = ct?.match(new RegExp(`${param}\\s*=\\s*"?([^";]+)"?`, "i"));
  return match?.[1]?.trim();
}

export function decodeBase64Url(data: string, charset = "utf-8"): string {
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename) return true;
  const disposition = headerValue(part.headers, "Content-Disposition");
  return /^\s*attachment/i.test(disposition ?? "");
}

// The first text/plain and text/html bodies (depth-first) plus every attachment.
export function collectParts(payload: GmailPart | undefined): {
  text: BodyPart | null;
  html: BodyPart | null;
  attachments: AttachmentInfo[];
} {
  let text: BodyPart | null = null;
  let html: BodyPart | null = null;
  const attachments: AttachmentInfo[] = [];

  function walk(part: GmailPart) {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (part.parts?.length) {
      for (const child of part.parts) walk(child);
      return;
    }
    if (isAttachment(part)) {
      attachments.push({
        partId: part.partId ?? "",
        filename: part.filename || "attachment",
        mimeType: mime || "application/octet-stream",
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId ?? null,
      });
      return;
    }
    if (mime !== "text/plain" && mime !== "text/html") return;
    const body: BodyPart = {
      mimeType: mime,
      charset: contentTypeParam(part, "charset") ?? "utf-8",
      ...(part.body?.data !== undefined ? { data: part.body.data } : {}),
      ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
    };
    if (mime === "text/plain" && !text) text = body;
    if (mime === "text/html" && !html) html = body;
  }

  if (payload) walk(payload);
  return { text, html, attachments };
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  zwnj: "",
  zwj: "",
  shy: "",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// Readable plain text from an HTML email: block tags become line breaks,
// links keep their target, everything else is stripped.
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|article|header|footer)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      if (!href || href.startsWith("mailto:") || !/^https?:/i.test(href)) return text;
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/\r/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Drops the quoted history of a reply ("On … wrote:" and "> " lines) so a
// thread reads as its new content only.
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";
    const attribution = /^On .+wrote:\s*$/i.test(line) || (/^On .+/i.test(line) && /wrote:\s*$/i.test(next));
    if (attribution || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^_{10,}$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function categoryOf(labelIds: string[]): MailCategory {
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "promotions";
  if (labelIds.includes("CATEGORY_SOCIAL")) return "social";
  if (labelIds.includes("CATEGORY_UPDATES")) return "updates";
  if (labelIds.includes("CATEGORY_FORUMS")) return "forums";
  return "primary";
}

export function hasAttachmentParts(payload: GmailPart | undefined): boolean {
  if (!payload) return false;
  if (payload.filename) return true;
  return (payload.parts ?? []).some(hasAttachmentParts);
}
