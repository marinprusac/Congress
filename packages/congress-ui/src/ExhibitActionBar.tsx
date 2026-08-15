import type { ReactNode } from "react";

interface ExhibitActionBarProps {
  children: ReactNode;
  className?: string;
}

// The Pin/Complete, Share, Edit, Delete (and, while editing, Save/Close)
// button cluster every view page has - rendered at the bottom of the
// content, above the backlinks/frontlinks panels, instead of in a title-row
// at the top. Deliberately just a styled wrapper around whatever buttons the
// caller passes: each Chamber's exact set of controls differs (Pin vs.
// Complete/Reopen, Delete living on a separate edit page for Calendar) too
// much to force through one rigid prop contract.
export function ExhibitActionBar({ children, className }: ExhibitActionBarProps) {
  return <div className={["exhibit-action-bar", className].filter(Boolean).join(" ")}>{children}</div>;
}
