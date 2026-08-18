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

// Inserted together, after the run completes - see chat.ts. The assistant
// row's timestamp is nudged 1ms later than the user row's so chronological
// ordering (by createdAt) is unambiguous even though both are written in the
// same call.
export function insertMessagePair(sessionId: string, userText: string, assistantText: string): { userMessage: Message; assistantMessage: Message } {
  const now = new Date();
  const userRow = db
    .insert(messages)
    .values({ sessionId, role: "user", text: userText, createdAt: now })
    .returning()
    .get();
  const assistantRow = db
    .insert(messages)
    .values({ sessionId, role: "assistant", text: assistantText, createdAt: new Date(now.getTime() + 1) })
    .returning()
    .get();
  return { userMessage: toMessage(userRow), assistantMessage: toMessage(assistantRow) };
}
