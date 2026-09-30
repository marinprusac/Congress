import { readerJson, readerMarkReadLocally, readerPath } from "./readerClient.js";

// Read-only views of wa-reader's data, shaped for the AI (MCP tools).
// Mirrors the reader's JSON (reader/internal/store/queries.go).

interface Chat {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: number;
  lastText?: string;
  lastType?: string;
  lastFromMe?: boolean;
  lastSender?: string;
  lastRevoked?: boolean;
  unreadCount?: number;
  markedUnread?: boolean;
}

interface Message {
  chatJid: string;
  chatName?: string;
  id: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  ts: number;
  type: string;
  text: string;
  quoted: { text: string; type: string; senderName: string; senderJid: string; fromMe: boolean } | null;
  editedAt: number | null;
  revokedAt: number | null;
  media: { mimetype: string; size: number; filename?: string; seconds?: number } | null;
  reactions: { emoji: string; senderJid: string; senderName: string }[];
  unread?: boolean;
}

export function jidLabel(jid: string): string {
  const [user = "", server = ""] = jid.split("@");
  const digits = user.split(":")[0]?.split(".")[0] ?? "";
  if (server === "s.whatsapp.net" && /^\d+$/.test(digits)) return `+${digits}`;
  return server === "g.us" ? "Unnamed group" : "Unknown contact";
}

const who = (m: { fromMe: boolean; senderName: string; senderJid: string }) => (m.fromMe ? "You" : m.senderName || jidLabel(m.senderJid));
const iso = (ms: number) => new Date(ms).toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function attachment(m: Message): string | undefined {
  if (!m.media) return undefined;
  const kb = m.media.size ? ` ${Math.max(1, Math.round(m.media.size / 1024))} KB` : "";
  const secs = m.media.seconds ? ` ${m.media.seconds}s` : "";
  const file = m.media.filename ? ` "${m.media.filename}"` : "";
  return `${m.type}${file}${secs}${kb}`;
}

export function formatChat(c: Chat) {
  const last = c.lastRevoked ? "(deleted)" : c.lastText || (c.lastType && c.lastType !== "text" ? `[${c.lastType}]` : "");
  return {
    jid: c.jid,
    name: c.name || jidLabel(c.jid),
    isGroup: c.isGroup,
    lastMessageAt: iso(c.lastMessageAt),
    ...(c.unreadCount ? { unread: c.unreadCount } : {}),
    ...(c.markedUnread && { markedUnread: true }),
    ...(c.lastType !== undefined && { last: `${c.lastFromMe ? "You" : c.lastSender || ""}${c.lastFromMe || c.lastSender ? ": " : ""}${clip(last, 160)}` }),
  };
}

export function formatMessage(m: Message, withChat = false) {
  const deleted = m.revokedAt !== null;
  return {
    ...(withChat && { chatJid: m.chatJid, chat: m.chatName || jidLabel(m.chatJid) }),
    id: m.id,
    at: iso(m.ts),
    from: who(m),
    ...(deleted ? { deleted: true } : { text: m.text || undefined }),
    ...(m.type !== "text" && !deleted && { type: m.type }),
    ...(!deleted && m.media && { attachment: attachment(m) }),
    ...(m.editedAt !== null && !deleted && { edited: true }),
    ...(m.quoted && !deleted && { replyTo: { from: m.quoted.senderJid || m.quoted.fromMe ? who(m.quoted) : "?", text: clip(m.quoted.text || `[${m.quoted.type || "message"}]`, 200) } }),
    ...(m.reactions.length > 0 && { reactions: m.reactions.map((r) => `${r.emoji} ${r.senderName || jidLabel(r.senderJid)}`) }),
    ...(m.unread && { unread: true }),
  };
}

export async function readerStatus() {
  const s = await readerJson<{ state: string; detail?: string; lastEventAt: number; lastPhoneAt: number; ownJid?: string }>("/status");
  return {
    state: s.state,
    ...(s.detail && { detail: s.detail }),
    linkedAs: s.ownJid ? jidLabel(s.ownJid) : null,
    lastEventAt: s.lastEventAt ? iso(s.lastEventAt) : null,
    phoneLastSeenAt: s.lastPhoneAt ? iso(s.lastPhoneAt) : null,
  };
}

export async function listChats(limit: number, cursor?: string) {
  const r = await readerJson<{ chats: Chat[]; nextCursor: string }>(
    readerPath("/chats", { limit: String(limit), cursor }, ["limit", "cursor"])
  );
  return { chats: r.chats.map(formatChat), nextCursor: r.nextCursor || null };
}

export async function findChats(query: string) {
  const r = await readerJson<{ chats: Chat[] }>(readerPath("/search", { q: query, limit: "1" }, ["q", "limit"]));
  return { chats: r.chats.map(formatChat) };
}

// A page of a chat, returned oldest-first; `olderCursor` continues backwards.
export async function readChat(jid: string, limit: number, before?: string, unreadOnly = false) {
  const [chat, page] = await Promise.all([
    readerJson<Chat>(`/chats/${encodeURIComponent(jid)}`),
    readerJson<{ messages: Message[]; nextCursor: string }>(
      readerPath(
        `/chats/${encodeURIComponent(jid)}/messages`,
        { limit: String(limit), cursor: before, unread: unreadOnly ? "1" : undefined },
        ["limit", "cursor", "unread"]
      )
    ),
  ]);
  return {
    chat: {
      jid: chat.jid,
      name: chat.name || jidLabel(chat.jid),
      isGroup: chat.isGroup,
      unread: chat.unreadCount ?? 0,
      ...(chat.markedUnread && { markedUnread: true }),
    },
    messages: [...page.messages].reverse().map((m) => formatMessage(m)),
    olderCursor: page.nextCursor || null,
  };
}

export async function searchMessages(query: string, jid: string | undefined, limit: number) {
  const r = await readerJson<{ messages: Message[] }>(
    readerPath("/search", { q: query, chat: jid, limit: String(limit) }, ["q", "chat", "limit"])
  );
  return { messages: r.messages.map((m) => formatMessage(m, true)) };
}

// Chats with unread messages (or marked unread), each with its newest unread
// messages oldest-first.
export async function listUnread(limit: number, perChat: number, cursor?: string) {
  const r = await readerJson<{
    chats: (Chat & { messages: Message[] })[];
    totalMessages: number;
    totalChats: number;
    nextCursor: string;
  }>(readerPath("/unread", { limit: String(limit), messages: String(perChat), cursor }, ["limit", "messages", "cursor"]));
  return {
    totalUnreadMessages: r.totalMessages,
    totalChats: r.totalChats,
    chats: r.chats.map((c) => {
      const { last: _last, ...chat } = formatChat(c);
      const shown = c.messages.length;
      return {
        ...chat,
        messages: [...c.messages].reverse().map((m) => formatMessage(m)),
        ...(c.unreadCount && c.unreadCount > shown && { olderUnreadNotShown: c.unreadCount - shown }),
      };
    }),
    nextCursor: r.nextCursor || null,
  };
}

// Congress-local read state only: no read receipt is sent, senders see nothing.
export async function markReadLocally(jid: string, upToMessageId?: string) {
  const chat = await readerJson<Chat>(readerMarkReadLocally(jid, upToMessageId));
  return { jid: chat.jid, unread: chat.unreadCount ?? 0, markedUnread: chat.markedUnread ?? false };
}
