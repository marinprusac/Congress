import { useCallback, useRef } from "react";

// After a create's own `navigate(..., { replace: true })`, a page's
// `useParams()` can lag one extra render behind a plain `setState` call made
// in the very same callback just before it - React Router's own location
// update isn't guaranteed to land in the same commit as that setState, even
// though both were triggered synchronously from the same mutation
// `onSuccess`. An identity-reset effect that compares `useParams()` against
// local identity state (see resolveEditorIdentity) can catch that one-render
// gap, see a spurious mismatch, and wrongly treat a self-navigate as "the
// user went somewhere else" - which resets local draft state and, worse,
// re-arms useDraftCreate's once-only guard (via its own `reset()`),
// producing a genuine duplicate create.
//
// `markSelfNavigate` (called right before that one `navigate()`) and
// `consumeSelfNavigate` (checked at the very top of the identity-reset
// effect, before any comparison) close that gap: the next identity check
// unconditionally treats itself as "keep" regardless of what params/local
// state actually say, and every check after that goes back to the normal
// comparison once params have caught up. Safe to call even when no race
// actually occurred that particular time - the check that would have run
// anyway resolves to "keep" either way.
export function useSelfNavigateGuard(): { markSelfNavigate: () => void; consumeSelfNavigate: () => boolean } {
  const pendingRef = useRef(false);

  const markSelfNavigate = useCallback(() => {
    pendingRef.current = true;
  }, []);

  const consumeSelfNavigate = useCallback(() => {
    if (!pendingRef.current) return false;
    pendingRef.current = false;
    return true;
  }, []);

  return { markSelfNavigate, consumeSelfNavigate };
}
