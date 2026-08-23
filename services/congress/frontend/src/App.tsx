import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry, NavPanel } from "@congress/congress-ui";
import { LoginGate } from "@/components/LoginGate";
import { ChamberHost, preloadChamber, ChamberWarmups } from "@/components/ChamberHost";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  // Warms every active Chamber's remote-entry.js/.css as soon as the
  // registry is known, regardless of which route this tab actually landed
  // on first - so ChamberHost's lazy import later resolves an
  // already-settled promise instead of a fresh fetch, and no Chamber ever
  // shows its loading bar on a first-ever visit within this tab.
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
  useEffect(() => {
    for (const chamber of registry ?? []) {
      if (chamber.status === "active") preloadChamber(chamber.name);
    }
  }, [registry]);

  // Every chamber-shaped route is "/:chamber/*" now that Capitol is an
  // ordinary registered Chamber rather than living at "/" - so the current
  // Chamber's own name is just the URL's first segment, with "/" (which
  // ChamberHost never renders) left undefined. Without this, ChamberWarmups
  // has no way to exclude whichever Chamber ChamberHost is already
  // rendering for real, and ends up rendering a redundant hidden second
  // copy of it (see ChamberWarmups' own comment for why that's wasted work,
  // not just a harmless no-op).
  const location = useLocation();
  // "/" redirects to "/capitol" below (Congress has no homepage content of
  // its own), so treated as "capitol" here too rather than left undefined -
  // that redirect fires before anything ever paints, and an undefined
  // current would otherwise make NavPanel briefly show a bogus row for
  // chamber name "" (see buildChamberList's own fallback in NavPanel.tsx).
  const currentChamberName = location.pathname === "/" ? "capitol" : (location.pathname.split("/")[1] ?? "capitol");

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
      <ChamberWarmups
        activeChamberNames={(registry ?? []).filter((c) => c.status === "active").map((c) => c.name)}
        currentChamberName={currentChamberName}
      />
      <Routes>
        {/* Congress itself has no homepage content of its own - Capitol
            (the Chamber registered as "capitol") is the widget canvas that
            makes up the landing page, so root just hands off to it. If
            Capitol isn't registered, the same ChamberUnavailable state every
            other missing Chamber gets shows up instead of a blank page. */}
        <Route path="/" element={<Navigate to="/capitol" replace />} />
        {/* Congress's own unified Settings - every Chamber's own settings
            content mounted as one tab-category each (see SettingsPage),
            reached through NavPanel's single Settings entry point instead
            of a per-Chamber route. Declared ahead of "/:chamber/*" below so
            it never gets swallowed by that pattern, though React Router's
            own static-over-dynamic ranking would already prefer it either
            way. */}
        <Route path="/settings" element={<SettingsPage />} />
        {/* Every Chamber - Capitol included - renders here, hosted directly
            in this shell instead of navigating away to it. See ChamberHost's
            own comment for how that works. */}
        <Route path="/:chamber/*" element={<ChamberHost />} />
      </Routes>
    </LoginGate>
  );
}
