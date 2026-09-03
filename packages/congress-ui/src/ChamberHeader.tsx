import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useShellHosted, resolveChamberPath } from "./ShellHostContext.js";

interface ChamberHeaderProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to titleHref's own resolution (see
  // resolveChamberPath) - Capitol passes "" since it isn't itself a
  // Chamber.
  ownChamber?: string;
  // Where the icon+title link goes - defaults to "/". Pass undefined for a
  // visitor with no session, so it doesn't bounce them to a login form they
  // can't use.
  titleHref?: string;
  // Extra controls rendered in the actions row, for a Chamber's own
  // header-specific chrome. Deliberately not baked into this shared
  // component - kept as an escape hatch for whatever a given Chamber's own
  // header needs (e.g. Deputy's Directives/History, Map's Places/Pending).
  extraActions?: ReactNode;
}

// Shared header markup for Capitol and every Chamber - eyebrow and the
// icon+title link. No back-link here, no search: NavPanel is the one way
// back to Capitol from anywhere, and now also owns the one Settings entry
// point (unified across every Chamber) and the one global search bar
// (GlobalExhibitSearch), both previously rendered per-Chamber in this
// header.
export function ChamberHeader({ icon, title, ownChamber = "", titleHref = "/", extraActions }: ChamberHeaderProps) {
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
        {extraActions ? <div className="chamber-header-actions">{extraActions}</div> : null}
      </div>
    </header>
  );
}
