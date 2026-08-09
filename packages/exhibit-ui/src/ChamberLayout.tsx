import type { ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

export interface ChamberNavLink {
  to: string;
  label: string;
}

interface ChamberLayoutProps {
  icon: ReactNode;
  title: string;
  navLinks: ChamberNavLink[];
}

// Shared shell for every Chamber's own frontend (Notes/Calendar/Documents) -
// header, primary nav, and a bottom nav bar that only renders on narrow
// viewports (see .chamber-mobile-nav in styles.css), since the top nav's
// small text links aren't a comfortable phone target.
export function ChamberLayout({ icon, title, navLinks }: ChamberLayoutProps) {
  const location = useLocation();

  return (
    <div className="chamber-shell">
      <header className="chamber-header">
        <a href="/" className="chamber-back-link">
          ← Capitol
        </a>
        <div className="chamber-header-row">
          <Link to="/" className="chamber-title-link">
            {icon}
            <h1 className="chamber-title">{title}</h1>
          </Link>
          <nav className="chamber-nav">
            {navLinks.map((link) => (
              <Link key={link.to} to={link.to} className="chamber-nav-link">
                {link.label}
              </Link>
            ))}
          </nav>
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
