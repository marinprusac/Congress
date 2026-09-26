import type { DirectiveSummary, DirectiveDetail, CreateDirectiveRequest, UpdateDirectiveRequest } from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

export const API_BASE = resolveApiBase("deputy", import.meta.env.PROD);

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

export function runDirective(id: number): Promise<{ ok: boolean; response: string | null; errorMessage: string | null }> {
  return fetch(`${API_BASE}/directives/${id}/run`, { method: "POST" }).then((res) => json(res));
}
