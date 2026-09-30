import { parseJsonResponse as json } from "@congress/congress-ui";

// Mirrors wa-reader's JSON (reader/internal/store/queries.go). Read-only: nothing
// here reaches WhatsApp (marking read changes only wa-reader's own DB).
export const API_BASE = "/congress/connectors/whatsapp";

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
  unreadCount: number;
  markedUnread: boolean;
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
  unread: boolean;
}

const enc = encodeURIComponent;

// 503 = the daemon itself is down; anything else is a real error.
export class ReaderUnavailableError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 503) throw new ReaderUnavailableError("reader_unavailable");
  return json<T>(res);
}

export interface WhatsappSettings {
  createPeople: boolean;
  minOwnerMessages: number;
  pending: number;
}

export const fetchSettings = () => get<WhatsappSettings>("/settings");

export async function saveSettings(createPeople: boolean): Promise<WhatsappSettings> {
  const res = await fetch(`${API_BASE}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ createPeople }) });
  return json<WhatsappSettings>(res);
}

export const fetchChatRecord = (jid: string) => get<{ id: string | null }>(`/chats/${enc(jid)}/record`);

export const fetchStatus = () => get<ReaderStatus>("/status");

export const fetchChats = (cursor?: string) =>
  get<{ chats: ChatSummary[]; nextCursor: string }>(`/chats?limit=50${cursor ? `&cursor=${enc(cursor)}` : ""}`);

export const fetchChat = (jid: string) => get<ChatSummary>(`/chats/${enc(jid)}`);

export const fetchMessages = (jid: string, cursor?: string) =>
  get<{ messages: Message[]; nextCursor: string }>(`/chats/${enc(jid)}/messages?limit=50${cursor ? `&cursor=${enc(cursor)}` : ""}`);

export const searchAll = (q: string) => get<{ chats: ChatSummary[]; messages: Message[] }>(`/search?q=${enc(q)}`);

export interface PairingSnapshot {
  state: "idle" | "waiting" | "success" | "expired" | "error";
  expiresAt?: number;
  qr?: string[];
  error?: string;
}

export const fetchPairing = () => get<PairingSnapshot>("/pairing");

// Starts (or rejoins) a QR session on the reader - linking, never sending.
export async function startPairing(): Promise<PairingSnapshot> {
  const res = await fetch(`${API_BASE}/pairing`, { method: "POST" });
  if (res.status === 503) throw new ReaderUnavailableError("reader_unavailable");
  return json<PairingSnapshot>(res);
}

// Local read state only: no read receipt is sent, WhatsApp and the sender see nothing.
export async function markReadLocally(jid: string, upTo?: string): Promise<ChatSummary> {
  const res = await fetch(`${API_BASE}/chats/${enc(jid)}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(upTo ? { upTo } : {}),
  });
  if (res.status === 503) throw new ReaderUnavailableError("reader_unavailable");
  return json<ChatSummary>(res);
}

export const mediaUrl = (m: Pick<Message, "chatJid" | "id">) => `${API_BASE}/media/${enc(m.chatJid)}/${enc(m.id)}`;

// Cursor that makes a page start at (and include) a given message.
export const cursorAt = (ts: number) => `${ts}|￿`;
