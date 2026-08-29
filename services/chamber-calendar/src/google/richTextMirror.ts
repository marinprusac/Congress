import { WIKILINK_PATTERN } from "@congress/chamber-kit";
import { parseExhibitToken, type ExhibitToken } from "@congress/shared-types";

// Replaces every "[[exhibit:chamber:id|Label]]" token in `rich` with its
// resolver's current label (falling back to the embedded alias/id when the
// resolver has none) - never leaves raw token syntax in the output. This is
// what keeps Google Calendar (the external source of truth) showing a
// human-readable string instead of internal token syntax, for both
// description and location.
export function projectRichToPlain(rich: string, resolveLabel: (token: ExhibitToken) => string | null): string {
  return rich.replace(WIKILINK_PATTERN, (match, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget?.trim();
    if (!target) return match;
    const parsed = parseExhibitToken(target);
    if (!parsed) return match;
    return resolveLabel(parsed) ?? (rawAlias?.trim() || parsed.id);
  });
}

// Decides what the locally-stored rich value should be after a fresh read
// from Google, when the caller doesn't already know the authored rich text
// for certain (i.e. this isn't the Chamber's own write-through - see
// resolveRichFields in cache.ts, which calls this once per field per event
// on the poll-sync/live-refetch path).
//
// `projectedFromPrevious` is `projectRichToPlain(previousRich, ...)` (or
// null if there was no previous rich value at all) - computed by the
// caller since it needs an async resolve this function deliberately stays
// free of, to keep it a plain, directly-unit-testable function.
export function reconcileRichValue(params: {
  previousRich: string | null;
  freshPlain: string | null;
  projectedFromPrevious: string | null;
}): { rich: string | null } {
  const { previousRich, freshPlain, projectedFromPrevious } = params;

  if (previousRich === null) {
    // No rich value ever recorded (a pre-migration row, or the field has
    // always been plain text) - treat Google's current plain text as the
    // rich value verbatim, so there's something for the editor to load.
    return { rich: freshPlain };
  }

  if (projectedFromPrevious === freshPlain) {
    // Google's text still matches what we'd project from the stored rich
    // value - nothing external changed it, keep the chips.
    return { rich: previousRich };
  }

  // Diverged: Google wins. Once divergence is detected there's no reliable
  // way to know what specifically changed, so trying to re-merge chip
  // positions risks fabricating wrong placement - losing chips on an
  // external edit is the honest, recoverable behavior (re-added via "@"
  // next time the event is opened here).
  return { rich: freshPlain };
}
