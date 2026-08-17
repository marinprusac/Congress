import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useShellHosted, resolveChamberPath } from "./ShellHostContext.js";

export interface WidgetPreviewShellProps {
  label: string;
  // This widget's own Chamber-relative "add new" target (e.g. "/new") - see
  // resolveChamberPath's doc comment for why it's written relative rather
  // than a pre-resolved absolute path.
  addHref: string;
  // Identifies this widget's own Chamber for resolveChamberPath - e.g.
  // "notes". Always a real Chamber (Capitol renders no widgets of its own).
  ownChamber: string;
  addLabel?: string;
  isLoading: boolean;
  isError: boolean;
  errorLabel: string;
  isEmpty: boolean;
  emptyLabel: string;
  // The item list itself - each Chamber renders its own item shape (a plain
  // title link for Notes/Documents, a title + time subtitle for Calendar),
  // so this stays a passed-in tree rather than a generic item renderer.
  children?: ReactNode;
}

// The chrome shared by every Chamber's widget content - mounted directly
// into Capitol's canvas as a real component (via each Chamber's own
// remote-entry.js widgets export - see ChamberHost/remoteModule.ts), not an
// iframe, so links here are ordinary same-document <Link>s through
// resolveChamberPath rather than a target="_top" iframe-breakout.
export function WidgetPreviewShell({
  label,
  addHref,
  ownChamber,
  addLabel = "+ New",
  isLoading,
  isError,
  errorLabel,
  isEmpty,
  emptyLabel,
  children,
}: WidgetPreviewShellProps) {
  const shellHosted = useShellHosted();

  return (
    <div className="flex h-full flex-col bg-parchment p-3 text-ink">
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-dust">{label}</p>
        <Link
          to={resolveChamberPath(addHref, ownChamber, shellHosted)}
          className="font-mono text-[10px] uppercase tracking-wide text-accent hover:underline"
        >
          {addLabel}
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">{errorLabel}</p>}
        {!isLoading && !isError && isEmpty && <p className="font-mono text-xs text-dust">{emptyLabel}</p>}
        {!isLoading && !isError && !isEmpty && children}
      </div>
    </div>
  );
}
