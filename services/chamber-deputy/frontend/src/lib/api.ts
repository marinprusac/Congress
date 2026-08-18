import type {
  DirectiveSummary,
  DirectiveDetail,
  CreateDirectiveRequest,
  UpdateDirectiveRequest,
  Message,
  PostChatMessageRequest,
  PostChatMessageResponse,
  DeputyRun,
  Settings,
  UpdateSettingsRequest,
} from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("deputy", import.meta.env.PROD);

export function fetchDirectives(): Promise<DirectiveSummary[]> {
  return fetch(`${API_BASE}/directives`).then((res) => json(res));
}

export function fetchRecentDirectives(): Promise<DirectiveSummary[]> {
  return fetch(`${API_BASE}/directives/recent`).then((res) => json(res));
}

export function searchDirectives(query: string): Promise<DirectiveSummary[]> {
  return fetch(`${API_BASE}/directives/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchDirective(id: number): Promise<DirectiveDetail> {
  return fetch(`${API_BASE}/directives/${id}`).then((res) => json(res));
}

export function createDirective(input: CreateDirectiveRequest): Promise<DirectiveDetail> {
  return fetch(`${API_BASE}/directives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateDirective(id: number, input: UpdateDirectiveRequest): Promise<DirectiveDetail> {
  return fetch(`${API_BASE}/directives/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteDirective(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/directives/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete directive");
}

export function fetchMessages(): Promise<Message[]> {
  return fetch(`${API_BASE}/chat/messages`).then((res) => json(res));
}

export function postChatMessage(input: PostChatMessageRequest): Promise<PostChatMessageResponse> {
  return fetch(`${API_BASE}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchRecentRuns(): Promise<DeputyRun[]> {
  return fetch(`${API_BASE}/runs/recent`).then((res) => json(res));
}

export function fetchRun(id: number): Promise<DeputyRun> {
  return fetch(`${API_BASE}/runs/${id}`).then((res) => json(res));
}

export function fetchSettings(): Promise<Settings> {
  return fetch(`${API_BASE}/settings`).then((res) => json(res));
}

export function updateSettings(input: UpdateSettingsRequest): Promise<Settings> {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchSpend(): Promise<{ spentTodayUsd: number }> {
  return fetch(`${API_BASE}/settings/spend`).then((res) => json(res));
}
