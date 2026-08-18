import type { ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ChamberHeader } from "./ChamberHeader.js";
import { ChamberPicker } from "./ChamberPicker.js";

interface ChamberLayoutProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to the global search bar (see GlobalExhibitSearch)
  // and its own icon lookup for rendering other Chambers' results.
  ownChamber: string;
  renderIcon: (chamber: string) => ReactNode;
  // Extra header chrome beyond search/settings - passed straight through to
  // ChamberHeader's own prop of the same name (e.g. Deputy's Directives/
  // History links). Most Chambers don't need this.
  extraActions?: ReactNode;
}

// Shared shell for every Chamber's own frontend (Notes/Calendar/Documents) -
// ChamberPicker (cross-Chamber nav) plus this Chamber's own header (which
// carries its own Settings link) and content. A Chamber's home route is
// always its default landing page (e.g. Notes' "All Notes" list) - there's
// no separate "home" nav link to it.
export function ChamberLayout({ icon, title, ownChamber, renderIcon, extraActions }: ChamberLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="chamber-shell">
      <ChamberPicker current={ownChamber} currentLabel={title} />
      <ChamberHeader
        icon={icon}
        title={title}
        ownChamber={ownChamber}
        renderIcon={renderIcon}
        navigate={navigate}
        settingsHref="/settings"
        extraActions={extraActions}
      />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
