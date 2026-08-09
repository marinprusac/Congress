import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult } from "@congress/shared-types";

interface ExhibitChipProps {
  result: CapitolExhibitResolveResult;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  className?: string;
  // Label captured at reference-insertion time (the markdown link's alias
  // text) - only used when the Exhibit can't be resolved live, since a
  // resolved chip always shows the current name, never a cached one.
  fallbackLabel?: string;
}

// Icon comes solely from the owning Chamber, resolved by the caller's
// `renderIcon`; when omitted (or the Chamber is unrecognized), falls back to
// a text prefix ("Notes — Meeting with Johan") per the Exhibits spec.
export function ExhibitChip({ result, renderIcon, onNavigate, className, fallbackLabel }: ExhibitChipProps) {
  if ("deleted" in result) {
    return (
      <span className={className} data-exhibit-state="deleted" title="This was deleted">
        {fallbackLabel ?? result.id}
      </span>
    );
  }

  if ("unavailable" in result) {
    return (
      <span className={className} data-exhibit-state="unavailable" title="Temporarily unavailable">
        {fallbackLabel ?? result.id}
      </span>
    );
  }

  const icon = renderIcon?.(result.chamber);

  return (
    <a
      className={className}
      data-exhibit-state="resolved"
      href={result.url}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(result as Extract<CapitolExhibitResolveResult, { url: string }>);
      }}
    >
      {icon ? (
        <span className="exhibit-chip-icon">{icon}</span>
      ) : (
        <span className="exhibit-chip-prefix">{result.chamber}</span>
      )}
      {result.name}
    </a>
  );
}
