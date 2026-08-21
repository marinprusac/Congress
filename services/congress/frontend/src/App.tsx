import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "@congress/congress-ui";
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
  const currentChamberName = location.pathname === "/" ? undefined : location.pathname.split("/")[1];

  return (
    <>
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
        <Route
          path="/"
          element={
            <LoginGate>
              <Navigate to="/capitol" replace />
            </LoginGate>
          }
        />
        {/* Congress's own unified Settings - every Chamber's own settings
            content mounted as one tab-category each (see SettingsPage),
            reached through NavPanel's single Settings entry point instead
            of a per-Chamber route. Declared ahead of "/:chamber/*" below so
            it never gets swallowed by that pattern, though React Router's
            own static-over-dynamic ranking would already prefer it either
            way. */}
        <Route
          path="/settings"
          element={
            <LoginGate>
              <SettingsPage />
            </LoginGate>
          }
        />
        {/* Every Chamber - Capitol included - renders here, hosted directly
            in this shell instead of navigating away to it. See ChamberHost's
            own comment for how that works. */}
        <Route
          path="/:chamber/*"
          element={
            <LoginGate>
              <ChamberHost />
            </LoginGate>
          }
        />
      </Routes>
    </>
  );
}
