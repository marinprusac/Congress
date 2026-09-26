import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { ChamberHeader } from "./ChamberHeader.js";
import { useBackNavigation } from "./chamberNav.js";

interface ChamberLayoutProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber (kept for callers; the header no longer links
  // anywhere Chamber-relative).
  ownChamber: string;
  // Extra header chrome beyond the title - passed straight through to
  // ChamberHeader. Not for navigation: Chambers have no nav of their own.
  extraActions?: ReactNode;
}

// Shared shell for every Chamber's own frontend: a header with a back
// button, then the page. There is no Chamber-level navigation any more -
// Congress's tab bar (Home · Search · + · Notifications · Settings) is the
// one way around, and a Chamber's pages are reached from the home feed,
// Search and the "+" sheet.
export function ChamberLayout({ icon, title, ownChamber, extraActions }: ChamberLayoutProps) {
  const back = useBackNavigation();

  return (
    <div className="chamber-shell">
      <ChamberHeader icon={icon} title={title} ownChamber={ownChamber} titleHref="" onBack={back} extraActions={extraActions} />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
