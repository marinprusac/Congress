import { desc } from "drizzle-orm";
import { db } from "./db/client.js";
import { messages } from "./db/schema.js";
import type { Message } from "./types.js";

function toMessage(row: typeof messages.$inferSelect): Message {
  return { id: row.id, sessionId: row.sessionId, role: row.role, text: row.text, createdAt: row.createdAt.toISOString() };
}

export interface LatestMessage {
  sessionId: string;
  createdAt: Date;
}

export function getLatestMessage(): LatestMessage | null {
  const row = db.select({ sessionId: messages.sessionId, createdAt: messages.createdAt }).from(messages).orderBy(desc(messages.createdAt)).limit(1).get();
  return row ?? null;
}

const MESSAGES_LIST_LIMIT = 200;

export async function listRecentMessages(limit = MESSAGES_LIST_LIMIT): Promise<Message[]> {
  const rows = db.select().from(messages).orderBy(desc(messages.createdAt)).limit(limit).all();
  return rows.map(toMessage).reverse();
}

// The owner's "start fresh" action (ChatPage's Clear button) - Deputy keeps
// no history beyond the current thread, so clearing means actually deleting
// every stored message, not starting a new session id alongside old ones.
export function deleteAllMessages(): void {
  db.delete(messages).run();
}

// Written the moment the message is sent, not held in memory until the run
// completes - see chat.ts. The queued headless run this message triggers can
// take a while (concurrency-1 job queue, plus the run itself), and
// ChatPage's optimistic cache write only lives in the browser's own
// React-Query cache: a refresh mid-run used to lose the just-sent message
// entirely until the assistant row landed alongside it, because both were
// inserted together only once the run finished.
export function insertUserMessage(sessionId: string, text: string): Message {
  const row = db
    .insert(messages)
    .values({ sessionId, role: "user", text, createdAt: new Date() })
    .returning()
    .get();
  return toMessage(row);
}

// Written once the run finishes, pairing with the user row insertUserMessage
// already wrote. `after` is that user row's own createdAt - the assistant
// row's timestamp is nudged 1ms later so chronological ordering (by
// createdAt) is unambiguous even on a fast reply.
export function insertAssistantMessage(sessionId: string, text: string, after: Date): Message {
  const row = db
    .insert(messages)
    .values({ sessionId, role: "assistant", text, createdAt: new Date(after.getTime() + 1) })
    .returning()
    .get();
  return toMessage(row);
}
