import type { ReactNode } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
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
      <header className="chamber-header">
        <div className="chamber-header-row">
          <Link to="/" className="chamber-title-link">
            {icon}
            <h1 className="chamber-title">{title}</h1>
          </Link>
          <div className="chamber-header-actions">
            <GlobalExhibitSearch ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
          </div>
        </div>
      </header>
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
