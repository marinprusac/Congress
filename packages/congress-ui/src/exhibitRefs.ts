import type { ManualRefsResponse } from "@congress/shared-types";

// Always routed through Capitol's proxy (POST/DELETE
// "/capitol/exhibits/:id/refs" in services/congress/src/server.ts), even
// when `exhibitId` is owned by the same Chamber the caller is running in -
// this is what lets a "Referenced by" panel add/remove a reference that
// actually lives on a *different* Exhibit than the one being viewed,
// without the frontend needing to know which Chamber owns it.
async function requestRefChange(
  exhibitId: string,
  path: string,
  init: RequestInit
): Promise<ManualRefsResponse> {
  const res = await fetch(`/capitol/exhibits/${encodeURIComponent(exhibitId)}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 404) {
      throw new Error(body?.message ?? "That exhibit doesn't support explicit references yet");
    }
    throw new Error(body?.message ?? body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// `targetChamber` lets Capitol eagerly cache the target if it's never been
// created/edited within Congress before (see manualRefRequestSchema's own
// comment) - always pass it when known (any CapitolExhibitSearchResult
// already carries `.chamber`).
//
// `sourceChamber` covers the mirror case: `exhibitId` itself (not the
// target) is the one that might be uncached - e.g. adding a task from a
// never-touched Google Calendar event's own "Referenced by" panel, where
// `exhibitId` here is that event's id. Capitol's routing normally resolves
// which Chamber owns `:id` from its cache alone; with nothing cached yet
// it has no way to route the proxy call at all, so this is passed as a
// query param (readable before/without the request body) rather than
// folded into `targetChamber` above.
export function addExhibitRef(
  exhibitId: string,
  targetExhibitId: string,
  targetChamber?: string,
  sourceChamber?: string
): Promise<ManualRefsResponse> {
  const qs = sourceChamber ? `?chamber=${encodeURIComponent(sourceChamber)}` : "";
  return requestRefChange(exhibitId, `/refs${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetExhibitId, targetChamber }),
  });
}

export function removeExhibitRef(exhibitId: string, targetExhibitId: string): Promise<ManualRefsResponse> {
  return requestRefChange(exhibitId, `/refs/${encodeURIComponent(targetExhibitId)}`, { method: "DELETE" });
}
