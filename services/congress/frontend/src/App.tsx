import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry, NavPanel } from "@congress/congress-ui";
import { LoginGate } from "@/components/LoginGate";
import { ChamberHost } from "@/components/ChamberHost";
import { SettingsPage } from "@/pages/SettingsPage";
import { HomePage } from "@/pages/HomePage";
import { NotificationBell } from "@/components/NotificationBell";

export function App() {
  // The registry changes when a Chamber (re)starts or goes stale, not on any
  // predictable cadence - this interval exists only as a safety net between
  // registrations/heartbeats, not as the primary way this data stays fresh
  // (refetchOnWindowFocus, on by default, covers the common case of coming
  // back to a backgrounded tab).
  const { data: registry } = useQuery({
    queryKey: ["congress", "registry"],
    queryFn: fetchRegistry,
    refetchInterval: 5 * 60_000,
  });

  // Every chamber-shaped route is "/:chamber/*", so the current Chamber's own
  // name is just the URL's first segment. "/" is Congress's own homepage
  // canvas, not a Chamber - NavPanel knows it as "home".
  const location = useLocation();
  const navigate = useNavigate();
  const currentChamberName = location.pathname === "/" ? "home" : (location.pathname.split("/")[1] ?? "home");

  return (
    // One LoginGate around everything, not one per route (each used to wrap
    // its own <Route> individually) - NavPanel needs the same gate every
    // route already had, and duplicating LoginGate a fourth time just for it
    // would be redundant given LoginGate's own auth check is global state,
    // not per-route data.
    <LoginGate>
      {/* Congress's own persistent nav, mounted once here rather than
          inside each Chamber's own Layout (see ChamberLayout's own comment
          in congress-ui) - a sibling of ChamberHost/Routes below, not
          nested inside either, so a Chamber that fails to load
          (ChamberErrorBoundary, a stale heartbeat) only loses its own
          content, never the ability to navigate elsewhere. currentLabel is
          only needed to avoid a flicker before the registry query above
          resolves - same reasoning each Chamber's own Layout passed its own
          hardcoded title for. */}
      <NavPanel
        current={currentChamberName}
        currentLabel={
          currentChamberName === "settings" ? "Settings" : registry?.find((c) => c.name === currentChamberName)?.displayName
        }
      />
      {/* Notification bell - fixed top-right chrome on every route, homepage
          and Chambers alike (see NotificationBell). A sibling of Routes for
          the same reason NavPanel is. */}
      <div className="shell-bell">
        <NotificationBell navigate={(path) => navigate(path)} />
      </div>
      <Routes>
        {/* Congress's own homepage: the widget canvas. Not a Chamber - it
            works with none registered. */}
        <Route path="/" element={<HomePage />} />
        {/* Capitol used to be a Chamber at /capitol - old bookmarks and the
            installed PWA's saved URL land here. */}
        <Route path="/capitol/*" element={<Navigate to="/" replace />} />
        {/* Same for the old Logs Chamber - its config lives in Settings now. */}
        <Route path="/logs/*" element={<Navigate to="/settings?from=logs" replace />} />
        {/* Congress's own unified Settings - every Chamber's own settings
            content mounted as one tab-category each (see SettingsPage),
            reached through NavPanel's single Settings entry point instead
            of a per-Chamber route. Declared ahead of "/:chamber/*" below so
            it never gets swallowed by that pattern, though React Router's
            own static-over-dynamic ranking would already prefer it either
            way. */}
        <Route path="/settings" element={<SettingsPage />} />
        {/* Every Chamber renders here, hosted directly
            in this shell instead of navigating away to it. See ChamberHost's
            own comment for how that works. */}
        <Route path="/:chamber/*" element={<ChamberHost />} />
      </Routes>
    </LoginGate>
  );
}
