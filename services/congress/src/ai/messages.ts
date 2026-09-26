import { desc } from "drizzle-orm";
import type { AiMessage } from "@congress/shared-types";
import { db } from "../db/client.js";
import { aiMessages } from "../db/schema.js";

function toMessage(row: typeof aiMessages.$inferSelect): AiMessage {
  return { id: row.id, sessionId: row.sessionId, role: row.role, text: row.text, createdAt: row.createdAt.toISOString() };
}

export interface LatestMessage {
  sessionId: string;
  createdAt: Date;
}

export function getLatestMessage(): LatestMessage | null {
  const row = db
    .select({ sessionId: aiMessages.sessionId, createdAt: aiMessages.createdAt })
    .from(aiMessages)
    .orderBy(desc(aiMessages.createdAt))
    .limit(1)
    .get();
  return row ?? null;
}

const MESSAGES_LIST_LIMIT = 200;

export function listRecentMessages(limit = MESSAGES_LIST_LIMIT): AiMessage[] {
  const rows = db.select().from(aiMessages).orderBy(desc(aiMessages.createdAt)).limit(limit).all();
  return rows.map(toMessage).reverse();
}

// The owner's "start fresh" action - the chat keeps no history beyond the
// current thread, so clearing deletes every stored message.
export function deleteAllMessages(): void {
  db.delete(aiMessages).run();
}

// Written the moment the message is sent, not once the run completes - the
// queued run can take a while, and the page's optimistic cache entry only
// lives in the browser's memory, so a refresh mid-run would otherwise lose
// the message until the reply landed.
export function insertUserMessage(sessionId: string, text: string): AiMessage {
  const row = db.insert(aiMessages).values({ sessionId, role: "user", text, createdAt: new Date() }).returning().get();
  return toMessage(row);
}

// `after` is the paired user row's createdAt - nudged 1ms later so ordering
// by createdAt is unambiguous even on a fast reply.
export function insertAssistantMessage(sessionId: string, text: string, after: Date): AiMessage {
  const row = db
    .insert(aiMessages)
    .values({ sessionId, role: "assistant", text, createdAt: new Date(after.getTime() + 1) })
    .returning()
    .get();
  return toMessage(row);
}
