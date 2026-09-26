import type { AiMessage, AiSettings, PostAiChatMessageRequest, PostAiChatMessageResponse, UpdateAiSettingsRequest } from "@congress/shared-types";
import { parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

// Congress's own AI API (services/congress/src/ai/routes.ts) - same-origin in
// production, proxied by vite in dev.
const API_BASE = "/congress/ai";

export const aiMessagesQueryKey = ["congress", "ai", "messages"] as const;
export const aiSpendQueryKey = ["congress", "ai", "spend"] as const;

export function fetchAiMessages(): Promise<AiMessage[]> {
  return fetch(`${API_BASE}/chat/messages`).then((res) => json(res));
}

export function postAiChatMessage(input: PostAiChatMessageRequest): Promise<PostAiChatMessageResponse> {
  return fetch(`${API_BASE}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function clearAiChatThread(): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/messages`, { method: "DELETE" });
  assertDeleteOk(res, "clear chat thread");
}

export function updateAiSettings(input: UpdateAiSettingsRequest): Promise<AiSettings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchAiSpend(): Promise<{ spentTodayUsd: number }> {
  return fetch(`${API_BASE}/settings/spend`).then((res) => json(res));
}
