import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShellHosted } from "./ShellHostContext.js";
import { runNavigation } from "./motion.js";

// Chambers have no navigation of their own any more - Congress's home feed,
// Search and "+" are how the owner gets to anything. These two helpers are
// what a Chamber page needs instead.

// Back to wherever the owner came from; to Congress's home when there's no
// in-app history to go back to (a cold load of a deep link, a push-
// notification tap). Standalone (a Chamber's own dev server), "home" means
// Congress's root, a full navigation out of this Chamber's own router.
export function useBackNavigation(): () => void {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) runNavigation(() => navigate(-1), "pop");
    else if (shellHosted) runNavigation(() => navigate("/"), "pop", "/");
    else window.location.assign("/");
  };
}

// Rendered at the index route of a Chamber with no screen of its own at its
// root (Notes, Tasks, Documents, ...): there's no list page to land on any
// more - its exhibits live in the home feed and Search - so "/<chamber>"
// sends the owner home instead.
export function ChamberIndexRedirect() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  useEffect(() => {
    if (shellHosted) navigate("/", { replace: true });
    else window.location.replace("/");
  }, [navigate, shellHosted]);
  return null;
}
