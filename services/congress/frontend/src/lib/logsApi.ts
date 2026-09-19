import type {
  EventSettingsSummary,
  EventSettingsDetail,
  UpdateEventSettingsRequest,
  EventHistoryEntry,
} from "@congress/shared-types";
import { parseJsonResponse as json } from "@congress/congress-ui";

// Congress's own API - same-origin in production, proxied by vite in dev.
const API_BASE = "/congress";

export function fetchEventSettingsList(): Promise<EventSettingsSummary[]> {
  return fetch(`${API_BASE}/event-settings`).then((res) => json(res));
}

export function fetchEventSettings(eventType: string): Promise<EventSettingsDetail> {
  return fetch(`${API_BASE}/event-settings/${encodeURIComponent(eventType)}`).then((res) => json(res));
}

export function updateEventSettings(eventType: string, input: UpdateEventSettingsRequest): Promise<EventSettingsDetail> {
  return fetch(`${API_BASE}/event-settings/${encodeURIComponent(eventType)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => json(res));
}

export function fetchHistory(opts: { eventType?: string; actor?: string; limit?: number } = {}): Promise<EventHistoryEntry[]> {
  const params = new URLSearchParams();
  if (opts.eventType !== undefined) params.set("eventType", opts.eventType);
  if (opts.actor !== undefined) params.set("actor", opts.actor);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return fetch(`${API_BASE}/history${qs ? `?${qs}` : ""}`).then((res) => json(res));
}
