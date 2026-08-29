import type { CapitolExhibitResolveResult, ExhibitToken } from "@congress/shared-types";

// Server-side counterpart to congress-ui's own useResolvedExhibits (which
// resolves from the browser via a session cookie) - for a Chamber's own
// backend that needs the *current* human-readable label behind a token
// before it can act (e.g. chamber-calendar projecting a rich value's tokens
// to plain text before syncing to Google). Congress's own
// /congress/exhibits/resolve route accepts either auth (see
// requireSessionOrInternalToken, services/congress/src/auth.ts).
export async function resolveExhibitsServerSide(
  refs: ExhibitToken[],
  capitolUrl: string,
  internalToken: string
): Promise<CapitolExhibitResolveResult[]> {
  if (refs.length === 0) return [];
  const res = await fetch(`${capitolUrl}/congress/exhibits/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Congress-Internal-Token": internalToken },
    body: JSON.stringify({ refs }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Failed to resolve exhibits: ${res.status}`);
  const body = (await res.json()) as { results: CapitolExhibitResolveResult[] };
  return body.results;
}
