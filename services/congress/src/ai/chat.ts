import { randomUUID } from "node:crypto";
import type { AiMessage, PostAiChatMessageRequest } from "@congress/shared-types";
import { getLatestMessage, insertUserMessage, insertAssistantMessage, listRecentMessages, deleteAllMessages } from "./messages.js";
import { getAiSettings } from "./settings.js";
import { enqueue } from "./jobQueue.js";
import { runAi } from "./engine.js";
import { chatPromptBody } from "./prompt.js";
import { publishEvent } from "../events.js";

export function listMessages(): AiMessage[] {
  return listRecentMessages();
}

// The owner's explicit "start fresh" action. The next message posted after
// this naturally gets no session to resume (see resolveSessionToResume).
export function clearThread(): void {
  deleteAllMessages();
}

// Resume within the configured idle window so a follow-up ("delete that
// note" -> "actually just rename it") carries context; past it, start fresh.
function resolveSessionToResume(idleWindowMs: number): string | null {
  const latest = getLatestMessage();
  if (!latest) return null;
  const idleMs = Date.now() - latest.createdAt.getTime();
  return idleMs < idleWindowMs ? latest.sessionId : null;
}

export async function postChatMessage(input: PostAiChatMessageRequest): Promise<{ userMessage: AiMessage; assistantMessage: AiMessage }> {
  const settings = await getAiSettings();
  const resumeSessionId = resolveSessionToResume(settings.chatIdleWindowMs);

  // Persisted immediately, before the queued run starts, so the message
  // survives a page refresh mid-run. Its sessionId is only a best guess; the
  // assistant row inserted after it - the *latest* row - always carries the
  // real one, which is all resolveSessionToResume ever reads.
  const userMessage = insertUserMessage(resumeSessionId ?? randomUUID(), input.text);

  const result = await enqueue(() =>
    runAi({ kind: "chat", body: chatPromptBody(input.text), actor: "congress", resumeSessionId })
  );

  // A refused run never reaches the CLI, so it has no session id - fall back
  // to the one we tried to resume or minted above. That synthetic id simply
  // won't --resume later, which is fine: the next message starts fresh.
  const sessionId = result.sessionId ?? resumeSessionId ?? userMessage.sessionId;
  const replyText = result.ok ? (result.response ?? "(no response)") : (result.errorMessage ?? "The assistant failed to respond.");

  // Only worth an event when the chat actually did something - the exchange
  // itself is already visible in the thread.
  if (result.ok && result.transcript.length > 0) {
    publishEvent({
      chamber: "congress",
      type: "congress.ai_chat_run",
      actor: "congress",
      payload: {
        message: input.text,
        summary: result.response,
        toolCallCount: result.transcript.length,
        transcript: result.transcript,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      },
    });
  }

  const assistantMessage = insertAssistantMessage(sessionId, replyText, new Date(userMessage.createdAt));
  return { userMessage, assistantMessage };
}
