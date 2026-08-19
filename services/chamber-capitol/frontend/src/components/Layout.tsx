import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChamberPicker,
  ChamberHeader,
  CapitolMark,
  ChamberMark,
  useShellHosted,
  resolveChamberPath,
} from "@congress/congress-ui";

// Composes ChamberPicker/ChamberHeader by hand instead of the shared
// ChamberLayout wrapper (see every other Chamber's own Layout.tsx) so the
// canvas-only chrome below (isHome) can be threaded onto the shell/main
// wrapper divs.
export function Layout() {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();
  const { pathname } = useLocation();
  // Only the homepage's canvas needs to be a finite, unscrollable,
  // viewport-locked surface (see styles.css's .chamber-shell--canvas) -
  // Settings stays an ordinary scrolling page. Compared through
  // resolveChamberPath, not a bare "/" check, since useLocation().pathname
  // is basename-stripped standalone ("/") but the full unstripped path
  // ("/capitol") when shell-hosted - see ShellHostContext's own comment.
  const isHome = pathname === resolveChamberPath("/", "capitol", shellHosted);

  return (
    <div className={`chamber-shell${isHome ? " chamber-shell--canvas" : ""}`}>
      <ChamberPicker current="capitol" currentLabel="Capitol" />
      <ChamberHeader
        icon={<CapitolMark className="h-8 w-8 text-ink" />}
        title="Capitol"
        ownChamber="capitol"
        renderIcon={(chamber) => <ChamberMark name={chamber} />}
        navigate={(path) => navigate(path)}
        settingsHref="/settings"
      />
      <main className={`chamber-main${isHome ? " chamber-main--canvas" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
