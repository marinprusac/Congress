import type { CapitolExhibitResolveResult } from "@congress/shared-types";
import { resolveChamberPath } from "./ShellHostContext.js";

// A resolved Exhibit's `url` (e.g. "/e/1/cal/evt") is relative to its OWN
// Chamber's root, not to whichever Chamber's frontend happens to be
// rendering the chip. A same-Chamber reference can navigate via the local
// router (resolveChamberPath handles standalone vs. shell-hosted targeting,
// same as ChamberHeader/ChamberPicker), but a cross-Chamber one has no
// matching route in the current tree at all - either this Chamber's own
// standalone build, which has no idea another Chamber's routes even exist,
// or, shell-hosted, ChamberHost only ever has one Chamber's remote entry
// mounted at a time - so it needs a full navigation into the other
// Chamber's app instead.
export function navigateToExhibit(
  ownChamber: string,
  result: Extract<CapitolExhibitResolveResult, { url: string }>,
  localNavigate: (path: string) => void,
  // Defaults to standalone-mode resolution (unchanged pre-existing
  // behavior) for call sites that haven't been updated to pass this yet -
  // see useShellHosted's own comment for what it means and every current
  // caller for how to get it.
  shellHosted = false
): void {
  if (result.chamber === ownChamber) {
    localNavigate(resolveChamberPath(result.url, ownChamber, shellHosted));
  } else {
    window.location.href = `/${result.chamber}${result.url}`;
  }
}
