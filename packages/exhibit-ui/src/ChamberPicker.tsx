import { Fragment } from "react";
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

interface PickerChamber {
  name: string;
  displayName: string;
  href: string;
}

// The registry's own order is the one stable ordering every viewer agrees
// on regardless of which entry they currently have open - selecting a
// Chamber must never reshuffle the list, so nothing here is ever sorted by
// `current`. The one exception is the current Chamber not being in the
// registry yet (a cold load, or the fetch failing) - it's prepended so its
// own row/subnav never flickers away, using only locally-known info (no
// registry round trip needed for a Chamber's own icon, and every Chamber's
// home route is `/<name>` by its own manifest.ts convention). Once the
// registry does load, this Chamber settles into its normal registry-order
// position like every other entry.
function buildChamberList(
  registryChambers: { name: string; displayName: string; routes: { home: string } }[],
  current: string,
  currentLabel: string | undefined
): PickerChamber[] {
  const fromRegistry = registryChambers.map((c) => ({ name: c.name, displayName: c.displayName, href: c.routes.home }));
  if (current === "capitol" || fromRegistry.some((c) => c.name === current)) return fromRegistry;
  return [{ name: current, displayName: currentLabel ?? current, href: `/${current}` }, ...fromRegistry];
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

function ChamberIcon({ chamber, current, mobile }: { chamber: PickerChamber; current: string; mobile: boolean }) {
  const isCurrent = current === chamber.name;
  const linkClass = mobile ? "chamber-picker-mobile-link" : "chamber-picker-link";
  return (
    <a href={chamber.href} className={isCurrent ? `${linkClass} active` : linkClass}>
      <ChamberMark name={chamber.name} className="chamber-picker-icon" />
      {(!mobile || isCurrent) && (
        <span className={mobile ? "chamber-picker-mobile-label" : "chamber-picker-label"}>{chamber.displayName}</span>
      )}
    </a>
  );
}

// Persistent way to jump directly between Capitol and any Chamber, instead
// of round-tripping through the homepage - a fixed sidebar on desktop, a
// fixed bottom bar on mobile with Capitol centered among the Chambers (and
// its icon a little larger, since it's the hub they all register around).
// The currently-open entry's own sub-navigation nests directly under it
// (desktop) or sits in a bar directly above the icon row (mobile) - see
// .chamber-picker-subnav / .chamber-picker-mobile-subnav in styles.css.
// Top-level entries use plain <a> links, not <Link>, since every Chamber
// (and Capitol) is a fully separate app instance; the current entry's own
// sub-links use <Link> since those stay within that same app.
export function ChamberPicker({ current, currentNavLinks, currentLabel }: ChamberPickerProps) {
  const { data } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const { pathname } = useLocation();

  const registryChambers = (data ?? []).filter((c) => c.status === "active");
  const chambers = buildChamberList(registryChambers, current, currentLabel);

  // Mobile only: split around Capitol so it always sits in the middle of
  // the row regardless of how many Chambers are registered.
  const half = Math.ceil(chambers.length / 2);
  const beforeCapitol = chambers.slice(0, half);
  const afterCapitol = chambers.slice(half);

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
        {chambers.map((chamber) => (
          <Fragment key={chamber.name}>
            <ChamberIcon chamber={chamber} current={current} mobile={false} />
            {current === chamber.name && <Subnav links={currentNavLinks} pathname={pathname} />}
          </Fragment>
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
        {beforeCapitol.map((chamber) => (
          <ChamberIcon key={chamber.name} chamber={chamber} current={current} mobile />
        ))}
        <a
          href="/"
          className={current === "capitol" ? "chamber-picker-mobile-link active" : "chamber-picker-mobile-link"}
        >
          <CapitolMark className="chamber-picker-icon chamber-picker-icon-capitol" />
          {current === "capitol" && <span className="chamber-picker-mobile-label">Capitol</span>}
        </a>
        {afterCapitol.map((chamber) => (
          <ChamberIcon key={chamber.name} chamber={chamber} current={current} mobile />
        ))}
      </nav>
    </>
  );
}
