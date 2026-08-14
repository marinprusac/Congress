import type { ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { ChamberPicker } from "./ChamberPicker.js";

export interface ChamberNavLink {
  to: string;
  label: string;
}

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
// header, primary nav, and a bottom nav bar that only renders on narrow
// viewports (see .chamber-mobile-nav in styles.css), since the top nav's
// small text links aren't a comfortable phone target.
export function ChamberLayout({ icon, title, navLinks, ownChamber, renderIcon }: ChamberLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="chamber-shell">
      <ChamberPicker current={ownChamber} />
      <header className="chamber-header">
        <div className="chamber-header-row">
          <Link to="/" className="chamber-title-link">
            {icon}
            <h1 className="chamber-title">{title}</h1>
          </Link>
          <div className="chamber-header-actions">
            <GlobalExhibitSearch ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
            <nav className="chamber-nav">
              {navLinks.map((link) => (
                <Link key={link.to} to={link.to} className="chamber-nav-link">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="chamber-main">
        <Outlet />
      </main>
      <nav className="chamber-mobile-nav">
        {navLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={location.pathname === link.to ? "chamber-mobile-nav-link active" : "chamber-mobile-nav-link"}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
