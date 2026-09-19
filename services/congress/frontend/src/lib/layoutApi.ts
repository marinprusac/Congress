import type { CanvasScope, WidgetPlacement } from "@congress/shared-types";
import { parseJsonResponse as json, assertDeleteOk } from "@congress/congress-ui";

// Congress's own API, same-origin in production and proxied by vite in dev.
const API_BASE = "/congress";

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
