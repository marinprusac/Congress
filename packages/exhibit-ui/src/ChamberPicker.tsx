import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { fetchRegistry } from "./registry.js";
import { ChamberMark, CapitolMark } from "./ChamberMarks.js";

export interface ChamberNavLink {
  to: string;
  label: string;
}

interface ChamberPickerProps {
  // "capitol" or a Chamber's manifest name - which entry is highlighted as
  // the one currently open.
  current: string;
  // The current entry's own sub-navigation (e.g. Notes' "New"/"Settings",
  // Capitol's "Shares"/"Settings") - only ever shown nested under whichever
  // entry matches `current`, never under any other entry.
  currentNavLinks: ChamberNavLink[];
  // Display name for the current Chamber's own row - rendered immediately
  // from this rather than waiting on the registry fetch below (which is
  // what supplies every *other* Chamber's icon/label/link). Without this,
  // the current Chamber's own row - and its subnav - would flicker away
  // any time the registry fetch is slow or fails. Irrelevant/unused when
  // current === "capitol", whose own row is always hardcoded regardless of
  // the registry.
  currentLabel?: string;
}

function Subnav({ links, pathname }: { links: ChamberNavLink[]; pathname: string }) {
  if (links.length === 0) return null;
  return (
    <div className="chamber-picker-subnav">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={pathname === link.to ? "chamber-picker-subnav-link active" : "chamber-picker-subnav-link"}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

// Persistent way to jump directly between Capitol and any Chamber, instead
// of round-tripping through the homepage - a fixed sidebar on desktop, a
// fixed bottom bar on mobile. The currently-open entry's own sub-navigation
// nests directly under it (desktop) or sits in a bar directly above the
// icon row (mobile) - see .chamber-picker-subnav / .chamber-picker-mobile-
// subnav in styles.css. Top-level entries use plain <a> links, not <Link>,
// since every Chamber (and Capitol) is a fully separate app instance; the
// current entry's own sub-links use <Link> since those stay within that
// same app.
export function ChamberPicker({ current, currentNavLinks, currentLabel }: ChamberPickerProps) {
  const { data } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const { pathname } = useLocation();

  // Every other Chamber's icon/label/link genuinely needs the registry -
  // this app has no other way to know they exist. The *current* Chamber
  // needs none of that: its name is `current` itself, ChamberMark already
  // resolves an icon for any known chamber id with no network round trip,
  // and every Chamber's home route is that same convention (`/<name>`) per
  // its own manifest.ts - so its own row never depends on this fetch.
  const otherChambers = (data ?? []).filter((c) => c.status === "active" && c.name !== current);

  return (
    <>
      <nav className="chamber-picker-desktop" aria-label="Chambers">
        <a
          href="/"
          className={current === "capitol" ? "chamber-picker-capitol-link active" : "chamber-picker-capitol-link"}
        >
          <CapitolMark className="chamber-picker-capitol-icon" />
          <span className="chamber-picker-label">Capitol</span>
        </a>
        {current === "capitol" && <Subnav links={currentNavLinks} pathname={pathname} />}
        <div className="chamber-picker-divider" />
        {current !== "capitol" && (
          <>
            <a href={`/${current}`} className="chamber-picker-link active">
              <ChamberMark name={current} className="chamber-picker-icon" />
              <span className="chamber-picker-label">{currentLabel ?? current}</span>
            </a>
            <Subnav links={currentNavLinks} pathname={pathname} />
          </>
        )}
        {otherChambers.map((chamber) => (
          <a key={chamber.name} href={chamber.routes.home} className="chamber-picker-link">
            <ChamberMark name={chamber.name} className="chamber-picker-icon" />
            <span className="chamber-picker-label">{chamber.displayName}</span>
          </a>
        ))}
      </nav>

      <nav className="chamber-picker-mobile-subnav" aria-label="Current section">
        {currentNavLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={pathname === link.to ? "chamber-picker-mobile-subnav-link active" : "chamber-picker-mobile-subnav-link"}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <nav className="chamber-picker-mobile" aria-label="Chambers">
        <a
          href="/"
          className={current === "capitol" ? "chamber-picker-mobile-link active" : "chamber-picker-mobile-link"}
        >
          <CapitolMark className="chamber-picker-icon chamber-picker-icon-capitol" />
          {current === "capitol" && <span className="chamber-picker-mobile-label">Capitol</span>}
        </a>
        {current !== "capitol" && (
          <a href={`/${current}`} className="chamber-picker-mobile-link active">
            <ChamberMark name={current} className="chamber-picker-icon" />
            <span className="chamber-picker-mobile-label">{currentLabel ?? current}</span>
          </a>
        )}
        {otherChambers.map((chamber) => (
          <a key={chamber.name} href={chamber.routes.home} className="chamber-picker-mobile-link">
            <ChamberMark name={chamber.name} className="chamber-picker-icon" />
          </a>
        ))}
      </nav>
    </>
  );
}
