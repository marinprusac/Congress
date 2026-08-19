import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { MobileSearchReveal } from "./MobileSearchReveal.js";
import { useShellHosted, resolveChamberPath } from "./ShellHostContext.js";

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

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
  // Same-Chamber Settings route, rendered as a gear icon button at the
  // start of the actions row (to the left of the search bar) - replaces
  // the old per-Chamber "Settings" nav-bar link now that ChamberPicker no
  // longer renders one. Omit to hide it entirely.
  settingsHref?: string;
  // Extra controls rendered between the settings icon and the search bar
  // in the actions row, for a Chamber's own header-specific chrome.
  // Deliberately not baked into this shared component - kept as an escape
  // hatch for whatever a given Chamber's own header needs beyond
  // search/settings (e.g. Deputy's Directives/History).
  extraActions?: ReactNode;
}

// Shared header markup for Capitol and every Chamber - eyebrow, icon+title
// link, and the global search bar. Previously this was inlined in
// ChamberLayout and separately hand-rolled (with different Tailwind
// utilities standing in for the same look) in Capitol's own CapitolHeader -
// now both render this one component. No back-link here: ChamberPicker is
// the one way back to Capitol from anywhere.
export function ChamberHeader({
  icon,
  title,
  ownChamber = "",
  renderIcon,
  navigate,
  showSearch = true,
  titleHref = "/",
  settingsHref,
  extraActions,
}: ChamberHeaderProps) {
  const shellHosted = useShellHosted();
  const resolvedTitleHref = titleHref ? resolveChamberPath(titleHref, ownChamber, shellHosted) : titleHref;
  const resolvedSettingsHref = settingsHref ? resolveChamberPath(settingsHref, ownChamber, shellHosted) : undefined;
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
        {(showSearch && navigate) || resolvedSettingsHref || extraActions ? (
          <div className="chamber-header-actions">
            {resolvedSettingsHref && (
              <Link to={resolvedSettingsHref} className="chamber-header-icon-link" aria-label="Settings" title="Settings">
                <SettingsIcon />
              </Link>
            )}
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
