import { resolveApiBase, parseJsonResponse as json } from "@congress/congress-ui";

// Mirrors wa-reader's JSON (reader/internal/store/queries.go). Read-only: GETs only.
export const API_BASE = resolveApiBase("whatsapp");

export interface ReaderStatus {
  state: string;
  since: number;
  detail?: string;
  lastEventAt: number;
  lastPhoneAt: number;
  mediaMaxBytes: number;
  paired?: boolean;
  ownJid?: string;
}

export interface ChatSummary {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: number;
  lastText: string;
  lastType: string;
  lastFromMe: boolean;
  lastSender: string;
  lastRevoked: boolean;
}

export interface MediaInfo {
  mimetype: string;
  size: number;
  filename?: string;
  width?: number;
  height?: number;
  seconds?: number;
  tooLarge?: boolean;
}

export interface Message {
  chatJid: string;
  chatName?: string;
  id: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  ts: number;
  type: string;
  text: string;
  quoted: { id: string; text: string; type: string; senderName: string; senderJid: string; fromMe: boolean } | null;
  editedAt: number | null;
  revokedAt: number | null;
  media: MediaInfo | null;
  reactions: { emoji: string; senderJid: string; senderName: string }[];
}

const enc = encodeURIComponent;

// 503 = the daemon itself is down; anything else is a real error.
export class ReaderUnavailableError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 503) throw new ReaderUnavailableError("reader_unavailable");
  return json<T>(res);
}

export const fetchStatus = () => get<ReaderStatus>("/status");

export const fetchChats = (cursor?: string) =>
  get<{ chats: ChatSummary[]; nextCursor: string }>(`/chats?limit=50${cursor ? `&cursor=${enc(cursor)}` : ""}`);

export const fetchChat = (jid: string) => get<ChatSummary>(`/chats/${enc(jid)}`);

export const fetchMessages = (jid: string, cursor?: string) =>
  get<{ messages: Message[]; nextCursor: string }>(`/chats/${enc(jid)}/messages?limit=50${cursor ? `&cursor=${enc(cursor)}` : ""}`);

export const searchAll = (q: string) => get<{ chats: ChatSummary[]; messages: Message[] }>(`/search?q=${enc(q)}`);

export const mediaUrl = (m: Pick<Message, "chatJid" | "id">) => `${API_BASE}/media/${enc(m.chatJid)}/${enc(m.id)}`;

// Cursor that makes a page start at (and include) a given message.
export const cursorAt = (ts: number) => `${ts}|￿`;
