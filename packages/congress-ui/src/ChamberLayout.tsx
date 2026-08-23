import type { ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ChamberHeader } from "./ChamberHeader.js";
import { NavPanel } from "./NavPanel.js";
import { useShellHosted } from "./ShellHostContext.js";

interface ChamberLayoutProps {
  icon: ReactNode;
  title: string;
  // Identifies this Chamber to the global search bar (see GlobalExhibitSearch)
  // and its own icon lookup for rendering other Chambers' results.
  ownChamber: string;
  renderIcon: (chamber: string) => ReactNode;
  // Extra header chrome beyond search/settings - passed straight through to
  // ChamberHeader's own prop of the same name (e.g. Deputy's Directives/
  // History links). Most Chambers don't need this.
  extraActions?: ReactNode;
}

// Shared shell for every Chamber's own frontend (Notes/Calendar/Documents) -
// NavPanel (cross-Chamber nav, plus the one unified Settings entry point)
// plus this Chamber's own header and content. A Chamber's home route is
// always its default landing page (e.g. Notes' "All Notes" list) - there's
// no separate "home" nav link to it.
//
// NavPanel only renders here when NOT shell-hosted (standalone dev boot, or
// a direct full-page load through Congress's gateway proxy at
// "/<chamber>/*") - shell-hosted, Congress's own App.tsx already mounts one
// persistent NavPanel outside ChamberHost, so it survives this Chamber
// failing to load instead of unmounting along with it. Rendering it again
// here too would just double it up.
export function ChamberLayout({ icon, title, ownChamber, renderIcon, extraActions }: ChamberLayoutProps) {
  const navigate = useNavigate();
  const shellHosted = useShellHosted();

  return (
    <div className="chamber-shell">
      {!shellHosted && <NavPanel current={ownChamber} currentLabel={title} />}
      <ChamberHeader
        icon={icon}
        title={title}
        ownChamber={ownChamber}
        renderIcon={renderIcon}
        navigate={navigate}
        extraActions={extraActions}
      />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
