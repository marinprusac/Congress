import type { ReactNode } from "react";

export interface ViewCardProps {
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

// The body every Chamber's home-feed view card shares - loading, error and
// empty states around the Chamber's own content. The card's frame (title,
// the "why it's here" reason, the link to the full view) is Congress's own
// (the feed's ViewSlot), built from the Chamber's manifest, so the card
// itself stays content-only. Mounted directly into Congress's document as a
// real component (via each Chamber's remote-entry.js `views` export), so
// links here are ordinary same-document <Link>s through resolveChamberPath.
export function ViewCard({ isLoading, isError, errorLabel, isEmpty, emptyLabel, children }: ViewCardProps) {
  return (
    <div className="flex h-full flex-col text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="font-mono text-xs text-dust">Loading —</p>}
        {isError && <p className="font-mono text-xs text-alert">{errorLabel}</p>}
        {!isLoading && !isError && isEmpty && <p className="font-mono text-xs text-dust">{emptyLabel}</p>}
        {!isLoading && !isError && !isEmpty && children}
      </div>
    </div>
  );
}
