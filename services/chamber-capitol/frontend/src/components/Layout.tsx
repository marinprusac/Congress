import { Outlet, useLocation } from "react-router-dom";
import { NavPanel, ChamberHeader, CapitolMark, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

// Composes NavPanel/ChamberHeader by hand instead of the shared
// ChamberLayout wrapper (see every other Chamber's own Layout.tsx) so the
// canvas-only chrome below (isHome) can be threaded onto the shell/main
// wrapper divs. NavPanel itself only renders here when NOT shell-hosted -
// see ChamberLayout's own comment on why: shell-hosted, Congress's App.tsx
// already mounts one persistent NavPanel outside ChamberHost.
export function Layout() {
  const shellHosted = useShellHosted();
  const { pathname } = useLocation();
  // Only the homepage's canvas needs to be a finite, unscrollable,
  // viewport-locked surface (see styles.css's .chamber-shell--canvas) -
  // every other route here stays an ordinary scrolling page. Compared
  // through resolveChamberPath, not a bare "/" check, since useLocation().pathname
  // is basename-stripped standalone ("/") but the full unstripped path
  // ("/capitol") when shell-hosted - see ShellHostContext's own comment.
  const isHome = pathname === resolveChamberPath("/", "capitol", shellHosted);

  return (
    <div className={`chamber-shell${isHome ? " chamber-shell--canvas" : ""}`}>
      {!shellHosted && <NavPanel current="capitol" currentLabel="Capitol" />}
      <ChamberHeader icon={<CapitolMark className="h-6 w-6 text-ink" />} title="Capitol" ownChamber="capitol" />
      <main className={`chamber-main${isHome ? " chamber-main--canvas" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
