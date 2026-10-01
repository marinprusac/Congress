import type { ReactNode } from "react";
import { StackLink } from "./navHooks.js";
import { resolveChamberPath } from "./ShellHostContext.js";

interface ChamberHeaderProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to titleHref's own resolution (see
  // resolveChamberPath) - Congress's own pages pass "" since they aren't a
  // Chamber.
  ownChamber?: string;
  // Where the icon+title link goes - defaults to "/". Pass "" for a title
  // that isn't a link.
  titleHref?: string;
  // Renders a back button before the title (ChamberLayout passes its
  // useBackNavigation) - Chamber pages have no other way back.
  onBack?: () => void;
  // Extra controls rendered in the actions row, for a page's own header
  // chrome (e.g. the Notifications page's "Mark all read").
  extraActions?: ReactNode;
}

// Shared header markup for Congress's own pages and every Chamber - eyebrow,
// optional back button, icon + title. Navigation and search live in
// Congress's tab bar, not here.
export function ChamberHeader({ icon, title, ownChamber = "", titleHref = "/", onBack, extraActions }: ChamberHeaderProps) {
  const resolvedTitleHref = titleHref ? resolveChamberPath(titleHref, ownChamber) : titleHref;
  const titleContent = (
    <>
      {icon}
      <h1 className="chamber-title">{title}</h1>
    </>
  );

  return (
    <header className="chamber-header">
      <div className="chamber-header-row">
        <div className="chamber-header-lead">
          {onBack && (
            <button type="button" className="chamber-header-back" onClick={onBack} aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          <div>
            <p className="chamber-eyebrow">Congress</p>
            {resolvedTitleHref ? (
              <StackLink to={resolvedTitleHref} className="chamber-title-link">
                {titleContent}
              </StackLink>
            ) : (
              <div className="chamber-title-link">{titleContent}</div>
            )}
          </div>
        </div>
        {extraActions ? <div className="chamber-header-actions">{extraActions}</div> : null}
      </div>
    </header>
  );
}
