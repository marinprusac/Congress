import type { ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ChamberHeader } from "./ChamberHeader.js";
import { ChamberPicker, type ChamberNavLink } from "./ChamberPicker.js";

export type { ChamberNavLink };

interface ChamberLayoutProps {
  icon: ReactNode;
  title: string;
  navLinks: ChamberNavLink[];
  // Identifies this Chamber to the global search bar (see GlobalExhibitSearch)
  // and its own icon lookup for rendering other Chambers' results.
  ownChamber: string;
  renderIcon: (chamber: string) => ReactNode;
}

// Shared shell for every Chamber's own frontend (Notes/Calendar/Documents) -
// header plus content. Primary navigation (navLinks) lives entirely in
// ChamberPicker now, nested under this Chamber's own entry since it's the
// current one - see .chamber-picker-subnav / .chamber-picker-mobile-subnav
// in styles.css.
export function ChamberLayout({ icon, title, navLinks, ownChamber, renderIcon }: ChamberLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="chamber-shell">
      <ChamberPicker current={ownChamber} currentNavLinks={navLinks} currentLabel={title} />
      <ChamberHeader icon={icon} title={title} ownChamber={ownChamber} renderIcon={renderIcon} navigate={navigate} />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
