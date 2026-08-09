import type { CapitolExhibitResolveResult } from "@congress/shared-types";

// A resolved Exhibit's `url` (e.g. "/e/1/cal/evt") is relative to its OWN
// Chamber's root, not to whichever Chamber's frontend happens to be
// rendering the chip. Each Chamber is a separate client-side-routed SPA
// (mounted at "/<chamber>/*" through Capitol's proxy), so a same-Chamber
// reference can navigate via the local router, but a cross-Chamber one has
// no matching route there at all and needs a full navigation into the
// other Chamber's app instead.
export function navigateToExhibit(
  ownChamber: string,
  result: Extract<CapitolExhibitResolveResult, { url: string }>,
  localNavigate: (path: string) => void
): void {
  if (result.chamber === ownChamber) {
    localNavigate(result.url);
  } else {
    window.location.href = `/${result.chamber}${result.url}`;
  }
}
