import { useEffect, useState } from "react";
import type { CanvasScope } from "../../../../src/types";

// Same breakpoint the rest of the app's mobile-first CSS uses (see
// styles.css's `@media (min-width: 641px)` overrides) - kept in sync
// deliberately, since a mismatch here would mean the canvas's own
// mobile/desktop split disagrees with which nav chrome (bottom bar vs.
// sidebar) is actually on screen.
const DESKTOP_QUERY = "(min-width: 641px)";

export function useCanvasScope(): CanvasScope {
  const [scope, setScope] = useState<CanvasScope>(() =>
    typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile"
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setScope(mql.matches ? "desktop" : "mobile");
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return scope;
}
