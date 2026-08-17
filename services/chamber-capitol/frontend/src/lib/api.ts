import type { CanvasScope, WidgetPlacement } from "../../../src/types";
import type { ShareSummary } from "@congress/shared-types";
import { resolveApiBase, parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

const API_BASE = resolveApiBase("capitol", import.meta.env.PROD);

export function fetchLayout(scope: CanvasScope): Promise<WidgetPlacement[]> {
  return fetch(`${API_BASE}/layout/${scope}`).then((res) => json(res));
}

// Returns null on a 409 (target cell already claimed by a different widget -
// see src/layout.ts) rather than throwing, so callers (auto-placement, drag)
// can retry against a freshly-fetched occupancy picture instead of treating
// it as a hard failure.
export async function upsertPlacement(
  scope: CanvasScope,
  chamber: string,
  widgetId: string,
  x: number,
  y: number
): Promise<WidgetPlacement | null> {
  const res = await fetch(`${API_BASE}/layout/${scope}/${chamber}/${widgetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y }),
  });
  if (res.status === 409) return null;
  return json(res);
}

export async function deletePlacement(scope: CanvasScope, chamber: string, widgetId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/layout/${scope}/${chamber}/${widgetId}`, { method: "DELETE" });
  assertDeleteOk(res, "unplace widget");
}

// Congress-owned (not this Chamber's own API) - shares live on the same
// backbone as the registry/gateway/exhibit fan-out, so Capitol's Shares page
// just calls it directly, same as every Chamber already does for exhibit
// search/resolve.
export async function fetchShares(): Promise<ShareSummary[]> {
  const res = await fetch("/congress/shares");
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  const data = (await res.json()) as { shares: ShareSummary[] };
  return data.shares;
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`/congress/shares/${encodeURIComponent(token)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}
