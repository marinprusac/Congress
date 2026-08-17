import type { LogRuleSummary, LogRuleDetail, CreateLogRuleRequest, UpdateLogRuleRequest, EventHistoryEntry } from "../../../src/types";
import type { PriorityLevel } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("logs", import.meta.env.PROD);

export function fetchLogRules(): Promise<LogRuleSummary[]> {
  return fetch(`${API_BASE}/log-rules`).then((res) => json(res));
}

export function fetchRecentLogRules(): Promise<LogRuleSummary[]> {
  return fetch(`${API_BASE}/log-rules/recent`).then((res) => json(res));
}

export function searchLogRules(query: string): Promise<LogRuleSummary[]> {
  return fetch(`${API_BASE}/log-rules/search?q=${encodeURIComponent(query)}`).then((res) => json(res));
}

export function fetchLogRule(id: number): Promise<LogRuleDetail> {
  return fetch(`${API_BASE}/log-rules/${id}`).then((res) => json(res));
}

export function createLogRule(input: CreateLogRuleRequest): Promise<LogRuleDetail> {
  return fetch(`${API_BASE}/log-rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function updateLogRule(id: number, input: UpdateLogRuleRequest): Promise<LogRuleDetail> {
  return fetch(`${API_BASE}/log-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export async function deleteLogRule(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/log-rules/${id}`, { method: "DELETE" });
  assertDeleteOk(res, "delete log rule");
}

export function fetchHistory(opts: { minPriority?: PriorityLevel; ruleId?: number; limit?: number } = {}): Promise<EventHistoryEntry[]> {
  const params = new URLSearchParams();
  if (opts.minPriority) params.set("minPriority", opts.minPriority);
  if (opts.ruleId !== undefined) params.set("ruleId", String(opts.ruleId));
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return fetch(`${API_BASE}/history${qs ? `?${qs}` : ""}`).then((res) => json(res));
}
