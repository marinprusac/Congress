import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAppliedTheme, ChamberPicker, fetchRegistry, type ChamberNavLink } from "@congress/congress-ui";
import { WidgetGrid } from "@/components/WidgetGrid";
import { LoginGate } from "@/components/LoginGate";
import { CapitolHeader } from "@/components/CapitolHeader";
import { ChamberHost, preloadChamber, ChamberWarmups } from "@/components/ChamberHost";
import { SharesPage } from "@/pages/SharesPage";
import { SharedViewPage } from "@/pages/SharedViewPage";
import { SettingsPage } from "@/pages/SettingsPage";

const CAPITOL_NAV_LINKS: ChamberNavLink[] = [
  { to: "/shares", label: "Shares" },
  { to: "/settings", label: "Settings" },
];

function Home() {
  return (
    <div className="min-h-screen bg-parchment text-ink capitol-shell">
      <CapitolHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <WidgetGrid />
      </main>
    </div>
  );
}

const CAPITOL_ONLY_PATHS = new Set(["/", "/shares", "/settings"]);

export function App() {
  useAppliedTheme();
  const location = useLocation();

  // Warms every active Chamber's remote-entry.js/.css as soon as the
  // registry is known, regardless of which route this tab actually landed
  // on first - so ChamberHost's lazy import later resolves an
  // already-settled promise instead of a fresh fetch, and no Chamber ever
  // shows its loading bar on a first-ever visit within this tab.
  const { data: registry } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  useEffect(() => {
    for (const chamber of registry ?? []) {
      if (chamber.status === "active") preloadChamber(chamber.name);
    }
  }, [registry]);

  // The public shared view has no Congress login and must not expose
  // internal navigation to a recipient without one. A hosted Chamber
  // (matched by ChamberHost's own "/:chamber/*" route) renders its own
  // ChamberPicker (current=that chamber) via its own ChamberLayout - same
  // component, same registry fetch, so it's already a complete substitute
  // for this one, just correctly reflecting the actual current entry and
  // that entry's own subnav instead of Capitol's. Rendering both at once
  // would show two nav bars, the outer one permanently stuck on "capitol".
  const isHostedChamberRoute = !CAPITOL_ONLY_PATHS.has(location.pathname) && !location.pathname.startsWith("/shared/");
  const showPicker = !location.pathname.startsWith("/shared/") && !isHostedChamberRoute;
  const currentChamberName = isHostedChamberRoute ? location.pathname.split("/")[1] : undefined;

  return (
    <>
      {showPicker && <ChamberPicker current="capitol" currentNavLinks={CAPITOL_NAV_LINKS} />}
      <ChamberWarmups
        activeChamberNames={(registry ?? []).filter((c) => c.status === "active").map((c) => c.name)}
        currentChamberName={currentChamberName}
      />
      <Routes>
        {/* Deliberately outside LoginGate - a share recipient has no Congress
            login at all, and never should need one to reach this page. */}
        <Route path="/shared/:token" element={<SharedViewPage />} />
        <Route
          path="/shares"
          element={
            <LoginGate>
              <SharesPage />
            </LoginGate>
          }
        />
        <Route
          path="/settings"
          element={
            <LoginGate>
              <SettingsPage />
            </LoginGate>
          }
        />
        <Route
          path="/"
          element={
            <LoginGate>
              <Home />
            </LoginGate>
          }
        />
        {/* Catch-all, so it never shadows the static routes above - renders
            whichever Chamber the first path segment names, hosted directly
            in this shell instead of navigating away to it. See
            ChamberHost's own comment for how that works. */}
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
