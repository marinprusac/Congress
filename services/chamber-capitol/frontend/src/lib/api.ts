import type { CanvasScope, WidgetPlacement } from "../../../src/types";
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
