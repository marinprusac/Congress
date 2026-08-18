import { randomUUID } from "node:crypto";
import { getLatestMessage, insertMessagePair, listRecentMessages } from "./messages.js";
import { getSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runDeputy } from "./engine.js";
import type { Message, PostChatMessageRequest } from "./types.js";

export function listMessages(): Promise<Message[]> {
  return listRecentMessages();
}

// Session resolution (docs/deputy-chamber-plan.md §8): resume within the
// configured idle window so a follow-up ("delete that note" -> "actually
// just rename it") carries context; past the window, or when the owner hits
// "New thread" in the UI (newThread, independent of the timeout), start
// fresh with no --resume.
function resolveSessionToResume(newThread: boolean, idleWindowMs: number): string | null {
  if (newThread) return null;
  const latest = getLatestMessage();
  if (!latest) return null;
  const idleMs = Date.now() - latest.createdAt.getTime();
  return idleMs < idleWindowMs ? latest.sessionId : null;
}

export async function postChatMessage(input: PostChatMessageRequest): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const settings = await getSettings();
  const resumeSessionId = resolveSessionToResume(input.newThread, settings.chatIdleWindowMs);

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
