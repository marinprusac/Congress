import type { SharedExhibitContent, UpdateSharedExhibitContentRequest, CapitolExhibitResolveResult } from "@congress/shared-types";
import type { ShareDetail } from "../../../src/types";

// Token-scoped client for the "/shared/:token" viewer - deliberately never
// touches the owner-session-gated /congress/shares endpoints in lib/api.ts.
// A recipient hitting this page has no Congress login at all.

function base(token: string): string {
  return `/congress/shared/${encodeURIComponent(token)}`;
}

export async function fetchSharedDetail(token: string): Promise<ShareDetail | null> {
  const res = await fetch(base(token));
  if (!res.ok) return null;
  return res.json();
}

export async function fetchSharedContent(token: string, id: string): Promise<SharedExhibitContent | null> {
  const res = await fetch(`${base(token)}/exhibits/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}

export function sharedDownloadUrl(token: string, id: string): string {
  return `${base(token)}/exhibits/${encodeURIComponent(id)}/download`;
}

export async function updateSharedContent(
  token: string,
  id: string,
  input: UpdateSharedExhibitContentRequest
): Promise<SharedExhibitContent | null> {
  const res = await fetch(`${base(token)}/exhibits/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function resolveSharedRefs(
  token: string,
  refs: { id: string; chamber: string }[]
): Promise<CapitolExhibitResolveResult[]> {
  const res = await fetch(`${base(token)}/exhibits/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refs }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results: CapitolExhibitResolveResult[] };
  return data.results;
}
