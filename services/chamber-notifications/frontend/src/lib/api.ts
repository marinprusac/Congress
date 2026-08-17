import type {
  AutomationSummary,
  AutomationDetail,
  AutomationRun,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "../../../src/types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("notifications", import.meta.env.PROD);

export function fetchAutomations(): Promise<AutomationSummary[]> {
  return fetch(`${API_BASE}/automations`).then((res) => json(res));
}

export function fetchRecentAutomations(): Promise<AutomationSummary[]> {
  return fetch(`${API_BASE}/automations/recent`).then((res) => json(res));
}

export function searchAutomations(query: string): Promise<AutomationSummary[]> {
  return fetch(`${API_BASE}/automations/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchAutomation(id: number): Promise<AutomationDetail> {
  return fetch(`${API_BASE}/automations/${id}`).then((res) => json(res));
}

export function fetchAutomationRuns(id: number): Promise<AutomationRun[]> {
  return fetch(`${API_BASE}/automations/${id}/runs`).then((res) => json(res));
}

export function createAutomation(input: CreateAutomationRequest): Promise<AutomationDetail> {
  return fetch(`${API_BASE}/automations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateAutomation(id: number, input: UpdateAutomationRequest): Promise<AutomationDetail> {
  return fetch(`${API_BASE}/automations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteAutomation(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/automations/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete automation");
}
