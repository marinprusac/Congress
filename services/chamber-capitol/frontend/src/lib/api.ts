import type { Settings, UpdateSettingsRequest } from "../../../src/types";
import type { ShareSummary } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json } from "@congress/congress-ui";

const API_BASE = resolveApiBase("capitol", import.meta.env.PROD);

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

// Congress-owned (not this Chamber's own API) - shares live on the same
// backbone as the registry/gateway/exhibit fan-out, so Capitol's Shares page
// just calls it directly, same as every Chamber already does for exhibit
// search/resolve.
export async function fetchShares(): Promise<ShareSummary[]> {
  const res = await fetch("/capitol/shares");
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`/capitol/shares/${encodeURIComponent(token)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}
