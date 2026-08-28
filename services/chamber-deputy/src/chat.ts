import { randomUUID } from "node:crypto";
import { getLatestMessage, insertMessagePair, listRecentMessages, deleteAllMessages } from "./messages.js";
import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import type { Message, PostChatMessageRequest } from "./types.js";

export function listMessages(): Promise<Message[]> {
  return listRecentMessages();
}

// The owner's explicit "start fresh" action (ChatPage's Clear button, shown
// in place of Send when the input is empty) - Deputy keeps no history
// beyond the current thread, so this deletes every stored message rather
// than just starting a new session id alongside the old ones. The next
// message posted after this naturally gets no session to resume (see
// resolveSessionToResume below), so no separate "force fresh" flag is
// needed on postChatMessage itself.
export function clearThread(): void {
  deleteAllMessages();
}

// Session resolution: resume within the configured idle window so a
// follow-up ("delete that note" -> "actually just rename it") carries
// context; past the window, start fresh with no --resume.
function resolveSessionToResume(idleWindowMs: number): string | null {
  const latest = getLatestMessage();
  if (!latest) return null;
  const idleMs = Date.now() - latest.createdAt.getTime();
  return idleMs < idleWindowMs ? latest.sessionId : null;
}

export async function postChatMessage(input: PostChatMessageRequest): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const settings = await getSettings();
  const resumeSessionId = resolveSessionToResume(settings.chatIdleWindowMs);

  const result = await enqueue(() => runDeputy({ trigger: "chat", chatMessage: input.text, resumeSessionId }));

  // A paused/budget-capped run never reaches the CLI, so it never produces a
  // session id - fall back to the session we tried to resume, or mint one so
  // this exchange still has somewhere to live. That synthetic id simply
  // won't --resume successfully later, which is fine: the next real message
  // starts fresh either way.
  const sessionId = result.sessionId ?? resumeSessionId ?? randomUUID();
  const replyText = result.ok ? (result.response ?? "(no response)") : (result.errorMessage ?? "Deputy failed to respond.");

  return insertMessagePair(sessionId, input.text, replyText);
}
