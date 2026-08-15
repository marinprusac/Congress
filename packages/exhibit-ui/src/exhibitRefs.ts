import type { ManualRefsResponse } from "@congress/shared-types";

// Always routed through Capitol's proxy (POST/DELETE
// "/capitol/exhibits/:id/refs" in services/capitol/src/server.ts), even
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

export function addExhibitRef(exhibitId: string, targetExhibitId: string): Promise<ManualRefsResponse> {
  return requestRefChange(exhibitId, "/refs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetExhibitId }),
  });
}

export function removeExhibitRef(exhibitId: string, targetExhibitId: string): Promise<ManualRefsResponse> {
  return requestRefChange(exhibitId, `/refs/${encodeURIComponent(targetExhibitId)}`, { method: "DELETE" });
}
