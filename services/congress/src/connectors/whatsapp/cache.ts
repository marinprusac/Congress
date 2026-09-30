import { desc, eq } from "drizzle-orm";
import type { ConnectorContext, SourceRecord, SyncResult } from "../contract.js";
import { whatsappDb as db } from "./db/client.js";
import { chats, settings } from "./db/schema.js";
import { readerJson, readerPath } from "./readerClient.js";
import { jidLabel } from "./aiRead.js";

type ChatRow = typeof chats.$inferSelect;

// A chat as the wa-reader lists it.
export interface ReaderChat {
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

// A 1:1 chat with a phone number (not a group, not a hidden-number "lid" contact).
export const phoneOf = (jid: string): string | null => {
  const m = jid.match(/^(\d+)(?:[:.]\d+)?@s\.whatsapp\.net$/);
  return m ? `+${m[1]}` : null;
};

export const getChatRow = (jid: string): ChatRow | undefined => db.select().from(chats).where(eq(chats.jid, jid)).get();
export const listChatRows = (): ChatRow[] => db.select().from(chats).orderBy(desc(chats.lastAt)).all();

export function getWhatsappSettings() {
  return db.select().from(settings).where(eq(settings.id, 1)).get() ?? { id: 1, createPeople: false };
}

export function setCreatePeople(on: boolean): void {
  db.insert(settings).values({ id: 1, createPeople: on }).onConflictDoUpdate({ target: settings.id, set: { createPeople: on } }).run();
}

function preview(c: ChatRow): string {
  const body = c.lastRevoked ? "(deleted)" : c.lastText || (c.lastType && c.lastType !== "text" ? `[${c.lastType}]` : "");
  const who = c.lastFromMe ? "You: " : c.isGroup && c.lastSender ? `${c.lastSender}: ` : "";
  return `${who}${body}`.slice(0, 200);
}

export function chatRecord(c: ChatRow): SourceRecord {
  const hasUnread = c.unreadCount > 0 || c.markedUnread;
  return {
    kind: "chat",
    key: c.jid,
    values: {
      name: c.name || jidLabel(c.jid),
      lastAt: new Date(c.lastAt).toISOString(),
      preview: preview(c),
      unread: c.unreadCount,
      hasUnread,
      lastFromMe: c.lastFromMe,
      isGroup: c.isGroup,
      phone: phoneOf(c.jid) ?? "",
      people: c.personId ? [c.personId] : [],
    },
    facts: { hasUnread },
    updatedAt: c.syncedAt.toISOString(),
  };
}

const rowOf = (c: ReaderChat) => ({
  jid: c.jid,
  name: c.name ?? "",
  isGroup: c.isGroup,
  lastAt: c.lastMessageAt,
  lastText: c.lastText ?? "",
  lastType: c.lastType ?? null,
  lastFromMe: c.lastFromMe ?? false,
  lastSender: c.lastSender ?? null,
  lastRevoked: c.lastRevoked ?? false,
  unreadCount: c.unreadCount ?? 0,
  markedUnread: c.markedUnread ?? false,
});

// Upserts a chat; returns whether anything a record shows changed.
export function storeChat(c: ReaderChat): boolean {
  const before = getChatRow(c.jid);
  const row = rowOf(c);
  const changed = !before || (Object.keys(row) as (keyof typeof row)[]).some((k) => before[k] !== row[k]);
  if (changed) {
    // Below the bar the count is stale once the chat moves: recount.
    const ownerMessages = before?.ownerMessages != null && before.ownerMessages >= MIN_OWNER_MESSAGES ? before.ownerMessages : null;
    db.insert(chats)
      .values({ ...row, ownerMessages, personId: before?.personId ?? null, syncedAt: new Date() })
      .onConflictDoUpdate({ target: chats.jid, set: { ...row, ownerMessages, syncedAt: new Date() } })
      .run();
  }
  return changed;
}

// A chat makes a Person only once the owner wrote at least this many messages in it (one-offs don't count).
export const MIN_OWNER_MESSAGES = 5;

// The owner's messages among the chat's last 100.
async function countOwnerMessages(c: ChatRow): Promise<number> {
  const page = await readerJson<{ messages: { fromMe: boolean }[] }>(readerPath(`/chats/${encodeURIComponent(c.jid)}/messages`, { limit: "100" }, ["limit"]));
  return page.messages.filter((m) => m.fromMe).length;
}

// Links a 1:1 chat to a Person by phone: creates one only if the owner wrote in it (and creation is on).
export async function linkPerson(ctx: ConnectorContext, jid: string): Promise<boolean> {
  const c = getChatRow(jid);
  const phone = c && !c.isGroup ? phoneOf(c.jid) : null;
  if (!c || !phone || c.personId) return false;
  let owned = c.ownerMessages;
  if (owned === null) {
    owned = await countOwnerMessages(c);
    db.update(chats).set({ ownerMessages: owned }).where(eq(chats.jid, jid)).run();
  }
  const name = c.name.trim() || null;
  const id = owned >= MIN_OWNER_MESSAGES && getWhatsappSettings().createPeople ? ctx.people.resolve({ phone, name }, "corresponded") : ctx.people.find({ phone });
  if (!id) return false;
  db.update(chats).set({ personId: id }).where(eq(chats.jid, jid)).run();
  return true;
}

let running: Promise<SyncResult> | null = null;

// Every chat the reader knows (it's a local socket, so the whole list is cheap).
// Changes are pulled quietly: chat activity is too frequent to announce.
export function syncWhatsapp(ctx: ConnectorContext): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    let changed = 0;
    try {
      let cursor: string | undefined;
      do {
        const page = await readerJson<{ chats: ReaderChat[]; nextCursor: string }>(readerPath("/chats", { limit: "200", cursor }, ["limit", "cursor"]));
        for (const c of page.chats) {
          const touched = storeChat(c);
          const linked = await linkPerson(ctx, c.jid).catch(() => false);
          if (touched || linked) {
            ctx.emitChange("chat", c.jid, false, true);
            changed++;
          }
        }
        cursor = page.nextCursor || undefined;
      } while (cursor);
      return { changed, error: null };
    } catch (err) {
      return { changed, error: (err as Error).message };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

// The 1:1 chats the owner wrote enough in that no Person matches yet (the dry-run count).
export const peopleToCreate = () => listChatRows().filter((c) => !c.isGroup && phoneOf(c.jid) && (c.ownerMessages ?? 0) >= MIN_OWNER_MESSAGES && !c.personId);
