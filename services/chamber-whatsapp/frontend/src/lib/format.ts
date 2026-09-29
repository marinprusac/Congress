import type { ChatSummary, Message, ReaderStatus } from "./api";

// "385911111111@s.whatsapp.net" -> "+385 91 111 1111"-ish: just "+<digits>".
export function jidLabel(jid: string): string {
  const [user = "", server = ""] = jid.split("@");
  const digits = user.split(":")[0]?.split(".")[0] ?? "";
  if (server === "s.whatsapp.net" && /^\d+$/.test(digits)) return `+${digits}`;
  if (server === "g.us") return "Group";
  return "Unknown contact";
}

export function chatTitle(chat: Pick<ChatSummary, "jid" | "name">): string {
  return chat.name || jidLabel(chat.jid);
}

export function senderLabel(m: Pick<Message, "fromMe" | "senderName" | "senderJid">): string {
  if (m.fromMe) return "You";
  return m.senderName || jidLabel(m.senderJid);
}

const TYPE_LABELS: Record<string, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  gif: "GIF",
  audio: "🎵 Audio",
  voice: "🎤 Voice message",
  document: "📄 Document",
  sticker: "Sticker",
  location: "📍 Location",
  contact: "👤 Contact",
  poll: "📊 Poll",
  unsupported: "Unsupported message",
  placeholder: "Message not synced",
};

// One-line preview for the chat list.
export function previewText(text: string, type: string, revoked: boolean): string {
  if (revoked) return "🚫 This message was deleted";
  const first = text.split("\n")[0]?.trim() ?? "";
  if (type === "text") return first;
  if (type === "poll" && first) return `📊 ${first}`;
  const label = typeLabel(type);
  return first && CAPTIONED.has(type) ? `${label}: ${first}` : label;
}

const CAPTIONED = new Set(["image", "video", "gif", "document"]);

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "Message";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Chat-list time: clock today, weekday this week, date otherwise.
export function listTime(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7 && days > 0) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "2-digit" });
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// Messages arrive newest-first; the chat shows them oldest-first with a
// day header wherever the day changes.
export function withDayBreaks(newestFirst: Message[]): { message: Message; day: string | null }[] {
  const out: { message: Message; day: string | null }[] = [];
  let lastKey = "";
  for (const m of [...newestFirst].reverse()) {
    const d = new Date(m.ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    out.push({ message: m, day: key === lastKey ? null : dayLabel(m.ts) });
    lastKey = key;
  }
  return out;
}

export const PHONE_WARN_DAYS = 10;

// What (if anything) the owner should be told about the reader's state.
export function statusNotice(status: ReaderStatus | null, unavailable: boolean, now = Date.now()): { tone: "alert" | "note"; text: string } | null {
  if (unavailable || !status) return { tone: "alert", text: "The WhatsApp reader isn't running. Showing nothing until it's back." };
  switch (status.state) {
    case "connected":
      break;
    case "not_paired":
      return { tone: "alert", text: "Not linked to WhatsApp yet. Pair it once with `wa-reader login` on the server." };
    case "logged_out":
      return { tone: "alert", text: "This device was unlinked from WhatsApp. Re-pair with `wa-reader login`." };
    case "stream_replaced":
      return { tone: "alert", text: "Another client took over this WhatsApp session. Restart the reader once it's gone." };
    case "client_outdated":
      return { tone: "alert", text: "WhatsApp rejected this client version. Update whatsmeow and redeploy." };
    case "temporary_ban":
      return { tone: "alert", text: `WhatsApp temporarily blocked this device (${status.detail ?? "no detail"}).` };
    case "offline":
      return { tone: "note", text: "Reader is in offline mode: showing stored messages only." };
    default:
      return { tone: "note", text: "Reconnecting to WhatsApp — messages may be a little behind." };
  }
  if (status.lastPhoneAt > 0) {
    const days = Math.floor((now - status.lastPhoneAt) / 86_400_000);
    if (days >= PHONE_WARN_DAYS) {
      return { tone: "alert", text: `Your phone hasn't been seen for ${days} days. Open WhatsApp on it — linked devices are unlinked after about 14.` };
    }
  }
  return null;
}
