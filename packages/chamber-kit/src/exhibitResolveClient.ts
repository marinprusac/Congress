import type { CapitolExhibitResolveResult, ExhibitToken } from "@congress/shared-types";
import { getCongressHost } from "./host.js";

// Server-side counterpart to congress-ui's useResolvedExhibits - for a
// Chamber's backend that needs a token's current label (e.g. chamber-calendar
// projecting rich text to plain before syncing to Google).
export async function resolveExhibitsServerSide(refs: ExhibitToken[]): Promise<CapitolExhibitResolveResult[]> {
  if (refs.length === 0) return [];
  const host = getCongressHost();
  if (!host) throw new Error("Congress host not available");
  return host.resolveExhibits(refs);
}
