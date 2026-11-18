import { desc, eq } from "drizzle-orm";
import type { ConnectorContext, SyncResult } from "../contract.js";
import { whatsappDb as db } from "./db/client.js";
import { chats } from "./db/schema.js";
import { readerJson, readerPath } from "./readerClient.js";

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
  mutedUntil?: number;
}

// The reader's mute (0 none, -1 forever, else epoch ms) as of now.
export const isMuted = (until: number, now = Date.now()): boolean => until === -1 || until > now;

// A 1:1 chat with a phone number (not a group, not a hidden-number "lid" contact).
export const phoneOf = (jid: string): string | null => {
  const m = jid.match(/^(\d+)(?:[:.]\d+)?@s\.whatsapp\.net$/);
  return m ? `+${m[1]}` : null;
};

export const getChatRow = (jid: string): ChatRow | undefined => db.select().from(chats).where(eq(chats.jid, jid)).get();
export const listChatRows = (): ChatRow[] => db.select().from(chats).orderBy(desc(chats.lastAt)).all();

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
  mutedUntil: c.mutedUntil ?? 0,
  muted: isMuted(c.mutedUntil ?? 0),
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

// A 1:1 chat is direct contact once the owner wrote at least this many messages in it (one-offs don't count).
export const MIN_OWNER_MESSAGES = 5;

// The owner's messages among the chat's last 100.
async function countOwnerMessages(jid: string): Promise<number> {
  const page = await readerJson<{ messages: { fromMe: boolean }[] }>(readerPath(`/chats/${encodeURIComponent(jid)}/messages`, { limit: "100" }, ["limit"]));
  return page.messages.filter((m) => m.fromMe).length;
}

export const NEW_CONTACT_EVENT = "whatsapp.new_contact";

// Hands a 1:1 chat to the AI linker once, when it became direct contact and
// no Person has its phone yet. The AI decides whether to make a Person.
export async function offerContact(ctx: ConnectorContext, jid: string): Promise<boolean> {
  const c = getChatRow(jid);
  const phone = c && !c.isGroup ? phoneOf(c.jid) : null;
  if (!c || !phone || c.contactQueuedAt) return false;
  const done = () => db.update(chats).set({ contactQueuedAt: new Date() }).where(eq(chats.jid, jid)).run();
  if (ctx.people.find({ phone })) {
    done();
    return false;
  }
  let owned = c.ownerMessages;
  if (owned === null) {
    owned = await countOwnerMessages(jid);
    db.update(chats).set({ ownerMessages: owned }).where(eq(chats.jid, jid)).run();
  }
  if (owned < MIN_OWNER_MESSAGES) return false;
  ctx.publish(NEW_CONTACT_EVENT, { jid, phone, name: c.name.trim() || null, ownerMessages: owned });
  done();
  return true;
}

let running: Promise<SyncResult> | null = null;

// Every chat the reader knows (a local socket, so the whole list is cheap),
// kept only to spot new direct contacts; messages stay in the reader.
export function syncWhatsapp(ctx: ConnectorContext): Promise<SyncResult> {
  running ??= (async (): Promise<SyncResult> => {
    let changed = 0;
    try {
      let cursor: string | undefined;
      do {
        const page = await readerJson<{ chats: ReaderChat[]; nextCursor: string }>(readerPath("/chats", { limit: "200", cursor }, ["limit", "cursor"]));
        for (const c of page.chats) {
          if (storeChat(c)) changed++;
          await offerContact(ctx, c.jid).catch(() => false);
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
