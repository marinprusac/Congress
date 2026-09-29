import { useEffect, useRef } from "react";
import { useStackNav } from "./navHooks.js";

// Chambers have no navigation of their own any more - Congress's home feed,
// Search and "+" are how the owner gets to anything. These two helpers are
// what a Chamber page needs instead.

// Back to the page underneath on this tab's stack (see navStack.ts) - the
// tab's root when there's nothing underneath.
export function useBackNavigation(): () => void {
  const nav = useStackNav();
  return () => nav.pop();
}

// Rendered at the index route of a Chamber with no screen of its own at its
// root (Notes, Tasks, Documents, ...): there's no list page to land on any
// more - its exhibits live in the home feed and Search - so "/<chamber>"
// steps straight back to wherever the owner was.
export function ChamberIndexRedirect() {
  const nav = useStackNav();
  const done = useRef(false);
  useEffect(() => {
    // Once: a second pop (StrictMode's effect re-run) would go a page further.
    if (done.current) return;
    done.current = true;
    nav.pop({ transition: "none" });
  }, [nav]);
  return null;
}
