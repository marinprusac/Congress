import type { ManualRefsResponse } from "@congress/shared-types";

// Always routed through Capitol's proxy (POST/DELETE
// "/congress/exhibits/:id/connections" in services/congress/src/server.ts),
// even when `exhibitId` is owned by the same Chamber the caller is running
// in - this is what lets Capitol route to whichever Chamber actually owns
// the relevant id without the frontend needing to know that itself.
async function requestConnectionChange(
  exhibitId: string,
  path: string,
  init: RequestInit
): Promise<ManualRefsResponse> {
  const res = await fetch(`/congress/exhibits/${encodeURIComponent(exhibitId)}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 404) {
      throw new Error(body?.message ?? "That exhibit doesn't support explicit connections yet");
    }
    throw new Error(body?.message ?? body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// Adds a manual connection from `exhibitId` (the Exhibit currently being
// viewed, always already-cached) to `targetExhibitId`. `targetChamber` lets
// Capitol eagerly cache the target if it's never been created/edited within
// Congress before (see manualRefRequestSchema's own comment) - always pass
// it when known (any CapitolExhibitSearchResult already carries `.chamber`).
export function addExhibitConnection(
  exhibitId: string,
  targetExhibitId: string,
  targetChamber?: string
): Promise<ManualRefsResponse> {
  return requestConnectionChange(exhibitId, "/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetExhibitId, targetChamber }),
  });
}

// Removes the connection between `exhibitId` and `otherExhibitId` - Capitol
// resolves which of the two the underlying row is actually stored on, so
// this works regardless of which side it was originally added from.
export function removeExhibitConnection(exhibitId: string, otherExhibitId: string): Promise<ManualRefsResponse> {
  return requestConnectionChange(exhibitId, `/connections/${encodeURIComponent(otherExhibitId)}`, {
    method: "DELETE",
  });
}
