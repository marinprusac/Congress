import { Link } from "react-router-dom";

export function ListSearchInput({
  value,
  onChange,
  placeholder,
  newHref,
  newLabel = "New",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  // Same-Chamber route to create a new item - already resolved via
  // resolveChamberPath by the caller (same idiom as every other same-Chamber
  // <Link> in a list page). Rendered as a "+" button docked beside the
  // search input, replacing the old "New" entry in ChamberPicker's
  // now-removed sub-nav bar. Omit on a list page with no creation flow.
  newHref?: string;
  newLabel?: string;
}) {
  return (
    <div className="list-search-row">
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="list-search-input border border-dust bg-parchment px-3 py-2 font-mono text-base text-ink placeholder:text-dust focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
      {newHref && (
        <Link to={newHref} className="list-search-new" aria-label={newLabel} title={newLabel}>
          +
        </Link>
      )}
    </div>
  );
}

// Row-shaped placeholders (title-width + subtitle-width bars, matching a
// real list row's own proportions) instead of a single "Loading —" line -
// the shape reads as "content is coming" rather than a generic spinner, and
// doesn't jump/reflow once the real rows replace it. A gentle opacity pulse,
// not a shimmer gradient - this app's flat/no-gradients look doesn't want
// the generic shiny-skeleton effect. prefers-reduced-motion already turns
// off all animation durations globally (see styles.css's @layer base).
export function ListLoadingState() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="list-skeleton-row">
          <div className="list-skeleton-bar list-skeleton-title" />
          <div className="list-skeleton-bar list-skeleton-subtitle" />
        </div>
      ))}
    </div>
  );
}

export function ListErrorState({ label }: { label: string }) {
  return <div className="px-1 py-3 font-mono text-sm text-alert">Failed to reach the {label} API.</div>;
}

export function ListEmptyState({ label, hasQuery }: { label: string; hasQuery: boolean }) {
  return (
    <div className="border-b border-dust px-1 py-3 font-mono text-sm text-dust">
      — No {label} {hasQuery ? "match your search" : "yet"} —
    </div>
  );
}
