import type { ReactNode } from "react";
import { sourceColorStyle, useSourceColor } from "./sourceColor.js";
import type { CapitolRecordResolveResult } from "@congress/shared-types";

// Generic over T so a caller with a richer per-ref shape (e.g.
// RecordLinksLayout's RecordRefEntry, which adds `isManual`) gets an
// `onNavigate` typed to match instead of the plain base shape.
interface RecordChipProps<T extends CapitolRecordResolveResult> {
  result: T;
  renderIcon?: (chamber: string, type?: string) => ReactNode;
  onNavigate?: (result: Extract<T, { url: string }>) => void;
  className?: string;
  // Label captured at reference-insertion time (the markdown link's alias
  // text) - only used when the Record can't be resolved live, since a
  // resolved chip always shows the current name, never a cached one.
  fallbackLabel?: string;
}

// Icon comes solely from the owning Chamber, resolved by the caller's
// `renderIcon` (getChamberIcon - always resolves to something, a generic
// mark at worst); when `renderIcon` itself is omitted, falls back to a text
// prefix ("Notes — Meeting with Johan") per the Records spec.
export function RecordChip<T extends CapitolRecordResolveResult = CapitolRecordResolveResult>({
  result,
  renderIcon,
  onNavigate,
  className,
  fallbackLabel,
}: RecordChipProps<T>) {
  const color = useSourceColor("chamber" in result ? result.chamber : "", "type" in result ? (result.type as string | undefined) : undefined);
  if ("deleted" in result) {
    return (
      <span className={className} data-record-state="deleted" title="This was deleted">
        {fallbackLabel ?? result.id}
      </span>
    );
  }

  if ("unavailable" in result) {
    return (
      <span className={className} data-record-state="unavailable" title="Temporarily unavailable">
        {fallbackLabel ?? result.id}
      </span>
    );
  }

  const icon = renderIcon?.(result.chamber, result.type);

  return (
    <a
      className={className}
      data-record-state="resolved"
      style={sourceColorStyle(color)}
      href={result.url}
      onClick={(e) => {
        if (!onNavigate) return;
        e.preventDefault();
        onNavigate(result as Extract<T, { url: string }>);
      }}
    >
      {icon ? (
        <span className="record-chip-icon">{icon}</span>
      ) : (
        <span className="record-chip-prefix">{result.chamber}</span>
      )}
      {result.name}
    </a>
  );
}
