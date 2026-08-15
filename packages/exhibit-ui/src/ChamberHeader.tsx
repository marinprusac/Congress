import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { MobileSearchReveal } from "./MobileSearchReveal.js";

interface ChamberHeaderProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to the global search bar (see GlobalExhibitSearch)
  // and its own icon lookup for rendering other Chambers' results. Capitol
  // passes "" since it isn't itself a Chamber.
  ownChamber?: string;
  renderIcon?: (chamber: string) => ReactNode;
  navigate?: (path: string) => void;
  // The global search bar hits a session-gated endpoint - SharedViewPage
  // (a token-scoped, no-login view) hides it rather than showing a search
  // box that can only ever fail for that visitor.
  showSearch?: boolean;
  // Where the icon+title link goes - defaults to "/". SharedViewPage passes
  // undefined: an anonymous recipient has no session, so Capitol's own home
  // route would just bounce them to a login form they can't use.
  titleHref?: string;
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
}: ChamberHeaderProps) {
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
          {titleHref ? (
            <Link to={titleHref} className="chamber-title-link">
              {titleContent}
            </Link>
          ) : (
            <div className="chamber-title-link">{titleContent}</div>
          )}
        </div>
        {showSearch && renderIcon && navigate && (
          <div className="chamber-header-actions">
            <GlobalExhibitSearch ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
          </div>
        )}
      </div>
      {showSearch && renderIcon && navigate && (
        <MobileSearchReveal ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
      )}
    </header>
  );
}
