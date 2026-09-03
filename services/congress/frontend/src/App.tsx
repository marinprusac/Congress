import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchRegistry, NavPanel } from "@congress/congress-ui";
import { LoginGate } from "@/components/LoginGate";
import { ChamberHost, preloadChamber, ChamberWarmups } from "@/components/ChamberHost";
import { SettingsPage } from "@/pages/SettingsPage";

// Runs `fn` for each item, but yields to the browser's idle time between
// calls instead of firing them all in the same tick - see the effect below
// for why this matters for a warmup that's explicitly not urgent. Falls
// back to a short setTimeout chain on Safari, which has no
// requestIdleCallback at all.
function runStaggered<T>(items: T[], fn: (item: T) => void): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const schedule =
    typeof requestIdleCallback === "function"
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
      : (cb: () => void) => window.setTimeout(cb, 200);
  const cancel =
    typeof cancelIdleCallback === "function" ? cancelIdleCallback : window.clearTimeout;
  let i = 0;
  function step() {
    if (cancelled || i >= items.length) return;
    fn(items[i]!);
    i++;
    handle = schedule(step) as number;
  }
  step();
  return () => {
    cancelled = true;
    if (handle !== undefined) cancel(handle);
  };
}

export function App() {
  const { data: registry } = useQuery({
    queryKey: ["congress", "registry"],
    queryFn: fetchRegistry,
    refetchInterval: 5 * 60_000,
  });

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

  // Warms every OTHER active Chamber's remote-entry.js/.css so ChamberHost's
  // lazy import later resolves an already-settled promise instead of a
  // fresh fetch, and no Chamber ever shows its loading bar on a first-ever
  // visit within this tab. The Chamber actually on screen right now is
  // preloaded immediately and separately (loadRemoteModule already covers
  // it via ChamberHost's own real render, but doing it here too costs
  // nothing thanks to that promise cache, and means it's never left waiting
  // behind the staggered loop below). Every other Chamber is staggered onto
  // idle time rather than fired in one synchronous burst - on a slow
  // connection, 9 simultaneous background fetches for Chambers nobody is
  // looking at were winning the browser's limited concurrent-connection
  // budget over the one fetch that actually mattered (confirmed via
  // resource-timing: the on-screen Chamber's own remote-entry.js was
  // finishing *last* of ten simultaneous fetches). None of this blocks
  // real navigation - a genuine click into an unwarmed Chamber still calls
  // loadRemoteModule directly and fetches it immediately, same as always.
  // The registry changes when a Chamber (re)starts or goes stale, not on any
  // predictable cadence - the 5-minute refetchInterval above exists only as
  // a safety net between registrations/heartbeats, not as the primary way
  // this data stays fresh (refetchOnWindowFocus, on by default, covers the
  // common case of coming back to a backgrounded tab).
  useEffect(() => {
    const active = (registry ?? []).filter((c) => c.status === "active");
    if (active.some((c) => c.name === currentChamberName)) preloadChamber(currentChamberName);
    const rest = active.filter((c) => c.name !== currentChamberName);
    return runStaggered(rest, (c) => preloadChamber(c.name));
  }, [registry, currentChamberName]);

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
