import type {
  AiRunDetail,
  AiSettings,
  AiThread,
  AiThreadMessagesPage,
  CreateAiThreadRequest,
  CreateAiThreadResponse,
  OpenAsk,
  PostAiThreadMessageResponse,
  UpdateAiSettingsRequest,
  UpdateAiThreadRequest,
} from "@congress/shared-types";
import { parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

// Congress's own AI API (services/congress/src/ai/routes.ts) - same-origin in
// production, proxied by vite in dev.
const API_BASE = "/congress/ai";

export const aiThreadsQueryKey = ["congress", "ai", "threads"] as const;
export const aiThreadQueryKey = (id: number) => ["congress", "ai", "thread", id] as const;
export const aiThreadMessagesQueryKey = (id: number) => ["congress", "ai", "thread", id, "messages"] as const;
export const aiRunQueryKey = (id: string) => ["congress", "ai", "run", id] as const;
export const aiSpendQueryKey = ["congress", "ai", "spend"] as const;

// Surfaces the server's `message` (e.g. a 409 "busy") instead of a bare status.
async function jsonOrError<T>(res: Response): Promise<T> {
  if (res.ok) return json<T>(res);
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
}

const sendJson = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function fetchAiThreads(archived = false): Promise<AiThread[]> {
  return fetch(`${API_BASE}/threads${archived ? "?archived=1" : ""}`).then((res) => jsonOrError(res));
}

export function fetchAiThread(id: number): Promise<AiThread> {
  return fetch(`${API_BASE}/threads/${id}`).then((res) => jsonOrError(res));
}

export function createAiThread(input: CreateAiThreadRequest): Promise<CreateAiThreadResponse> {
  return fetch(`${API_BASE}/threads`, sendJson("POST", input)).then((res) => jsonOrError(res));
}

export function updateAiThread(id: number, input: UpdateAiThreadRequest): Promise<AiThread> {
  return fetch(`${API_BASE}/threads/${id}`, sendJson("PATCH", input)).then((res) => jsonOrError(res));
}

export async function deleteAiThread(id: number): Promise<void> {
  assertDeleteOk(await fetch(`${API_BASE}/threads/${id}`, { method: "DELETE" }), "delete chat");
}

export async function markAiThreadRead(id: number): Promise<void> {
  await fetch(`${API_BASE}/threads/${id}/read`, { method: "POST" });
}

export function fetchAiThreadMessages(id: number, before?: number): Promise<AiThreadMessagesPage> {
  return fetch(`${API_BASE}/threads/${id}/messages${before ? `?before=${before}` : ""}`).then((res) => jsonOrError(res));
}

export function postAiThreadMessage(id: number, text: string): Promise<PostAiThreadMessageResponse> {
  return fetch(`${API_BASE}/threads/${id}/messages`, sendJson("POST", { text })).then((res) => jsonOrError(res));
}

export function retryAiThread(id: number): Promise<{ runId: string }> {
  return fetch(`${API_BASE}/threads/${id}/retry`, { method: "POST" }).then((res) => jsonOrError(res));
}

export async function cancelAiRun(runId: string): Promise<void> {
  await fetch(`${API_BASE}/runs/${runId}/cancel`, { method: "POST" });
}

export function fetchAiRun(runId: string): Promise<AiRunDetail> {
  return fetch(`${API_BASE}/runs/${runId}`).then((res) => jsonOrError(res));
}

export const aiAsksQueryKey = ["congress", "ai", "asks"] as const;

export function fetchOpenAsks(): Promise<OpenAsk[]> {
  return fetch(`${API_BASE}/asks`).then((res) => jsonOrError(res));
}

// A 400 carries per-field messages for the form.
export class AskAnswerError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string>
  ) {
    super(message);
  }
}

export async function answerAsk(messageId: number, values: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/messages/${messageId}/answer`, sendJson("POST", { values }));
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { message?: string; fieldErrors?: Record<string, string> } | null;
  throw new AskAnswerError(body?.message ?? `Couldn't send the answer (${res.status})`, body?.fieldErrors ?? {});
}

export async function decideAsk(messageId: number, approve: boolean, note?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/messages/${messageId}/decide`, sendJson("POST", { approve, note }));
  if (!res.ok) await jsonOrError(res);
}

export function updateAiSettings(input: UpdateAiSettingsRequest): Promise<AiSettings> {
  return fetch(`${API_BASE}/settings`, sendJson("PUT", input)).then((res) => json(res));
}

export function fetchAiSpend(): Promise<{ spentTodayUsd: number }> {
  return fetch(`${API_BASE}/settings/spend`).then((res) => json(res));
}
