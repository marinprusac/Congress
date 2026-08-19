import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { MobileSearchReveal } from "./MobileSearchReveal.js";
import { useShellHosted, resolveChamberPath } from "./ShellHostContext.js";

interface ChamberHeaderProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to the global search bar (see GlobalExhibitSearch)
  // and its own icon lookup for rendering other Chambers' results. Capitol
  // passes "" since it isn't itself a Chamber.
  ownChamber?: string;
  renderIcon?: (chamber: string) => ReactNode;
  navigate?: (path: string) => void;
  // The global search bar hits a session-gated endpoint - a header rendered
  // for a visitor with no session should pass false rather than showing a
  // search box that can only ever fail for them.
  showSearch?: boolean;
  // Where the icon+title link goes - defaults to "/". Pass undefined for a
  // visitor with no session, so it doesn't bounce them to a login form they
  // can't use.
  titleHref?: string;
  // Extra controls rendered before the search bar in the actions row, for a
  // Chamber's own header-specific chrome.
  // Deliberately not baked into this shared component - kept as an escape
  // hatch for whatever a given Chamber's own header needs beyond
  // search/settings (e.g. Deputy's Directives/History).
  extraActions?: ReactNode;
}

// Shared header markup for Capitol and every Chamber - eyebrow, icon+title
// link, and the global search bar. Previously this was inlined in
// ChamberLayout and separately hand-rolled (with different Tailwind
// utilities standing in for the same look) in Capitol's own CapitolHeader -
// now both render this one component. No back-link here: NavPanel is the
// one way back to Capitol from anywhere, and now also owns the one Settings
// entry point (unified across every Chamber) that used to be a gear icon
// rendered here per-Chamber.
export function ChamberHeader({
  icon,
  title,
  ownChamber = "",
  renderIcon,
  navigate,
  showSearch = true,
  titleHref = "/",
  extraActions,
}: ChamberHeaderProps) {
  const shellHosted = useShellHosted();
  const resolvedTitleHref = titleHref ? resolveChamberPath(titleHref, ownChamber, shellHosted) : titleHref;
  const titleContent = (
    <>
      {icon}
      <h1 className="chamber-title">{title}</h1>
    </>
  );

  return (
    <header className="chamber-header">
      <div className="chamber-header-row">
        <div>
          <p className="chamber-eyebrow">Congress</p>
          {resolvedTitleHref ? (
            <Link to={resolvedTitleHref} className="chamber-title-link">
              {titleContent}
            </Link>
          ) : (
            <div className="chamber-title-link">{titleContent}</div>
          )}
        </div>
        {(showSearch && navigate) || extraActions ? (
          <div className="chamber-header-actions">
            {extraActions}
            {showSearch && navigate && renderIcon && (
              <GlobalExhibitSearch ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
            )}
          </div>
        ) : null}
      </div>
      {showSearch && renderIcon && navigate && (
        <MobileSearchReveal ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
      )}
    </header>
  );
}
