import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CapitolExhibitResolveResult, CapitolExhibitSearchResult } from "@congress/shared-types";
import { ExhibitChip } from "./ExhibitChip.js";
import { useExhibitLinks } from "./useExhibitLinks.js";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { useKeyboardInset } from "./useKeyboardInset.js";

interface AddReferenceControlProps {
  exhibitId: string;
  existingIds: Set<string>;
  onAdd: (result: CapitolExhibitSearchResult) => void;
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
  renderIcon?: (chamber: string) => ReactNode;
}

// The "+" trigger in the References panel header - an explicit way to
// attach a reference to another Exhibit without writing a "[[" token in
// body text, for Exhibits that either have no natural text area or where a
// reference doesn't belong inline. Deliberately a separate, simpler control
// from useExhibitPicker/ExhibitPickerDropdown (no textarea, no caret math)
// even though the search/create/keyboard-nav shape mirrors it closely.
function AddReferenceControl({ exhibitId, existingIds, onAdd, onCreate, renderIcon }: AddReferenceControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const keyboardInset = useKeyboardInset();

  const { results: rawResults, loading } = useExhibitSearch(query, open);
  const results = rawResults.filter((r) => r.id !== exhibitId && !existingIds.has(r.id));
  const trimmedQuery = query.trim();
  const showCreate =
    Boolean(onCreate) && trimmedQuery.length > 0 && !results.some((r) => r.name.toLowerCase() === trimmedQuery.toLowerCase());

  useEffect(() => {
    setActiveIndex(0);
    setError(null);
  }, [query]);

  function openPicker() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function close() {
    setOpen(false);
    setQuery("");
    setError(null);
  }

  function select(result: CapitolExhibitSearchResult) {
    onAdd(result);
    close();
  }

  function createNew() {
    if (!onCreate || !trimmedQuery) return;
    setCreating(true);
    setError(null);
    onCreate(trimmedQuery)
      .then((result) => select(result))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to create"))
      .finally(() => setCreating(false));
  }

  if (!open) {
    return (
      <button
        type="button"
        className="exhibit-ref-add-trigger tap-target"
        onClick={openPicker}
        aria-label="Add reference"
        title="Add reference"
      >
        +
      </button>
    );
  }

  const total = results.length + (showCreate ? 1 : 0);
  // The popover (input + dropdown together) is positioned as one unit,
  // independent of the header row's flex layout - the References panel is
  // only 12rem wide on desktop (see .exhibit-links-panel-front) and a
  // narrow stacked half-column on mobile, either of which would otherwise
  // squeeze a flex sibling <input> down to a sliver instead of giving it
  // room to be usable. Same fixed-above-keyboard treatment as
  // ExhibitPickerDropdown on mobile.
  const popoverStyle: Record<string, string> = {};
  if (keyboardInset > 0) popoverStyle.bottom = `calc(0.5rem + ${keyboardInset}px)`;

  return (
    <div className="exhibit-ref-add">
      <div className="exhibit-ref-add-popover" style={Object.keys(popoverStyle).length > 0 ? popoverStyle : undefined}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // A timeout, not an immediate close - lets a result's onMouseDown
          // (which fires select before this) win the race.
          onBlur={() => setTimeout(close, 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
              return;
            }
            if (total === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % total);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (i - 1 + total) % total);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (activeIndex < results.length) {
                const active = results[activeIndex];
                if (active) select(active);
              } else if (showCreate) {
                createNew();
              }
            }
          }}
          placeholder="Search to reference —"
          aria-label="Search to reference"
          className="exhibit-ref-add-input"
        />
        <div className="exhibit-ref-add-dropdown" role="listbox">
          {loading && results.length === 0 && <div className="exhibit-picker-empty">Searching —</div>}
          {!loading && results.length === 0 && !showCreate && (
            <div className="exhibit-picker-empty">{trimmedQuery ? "No matches" : "— Type to search —"}</div>
          )}
          {results.map((result, index) => (
            <div
              key={`${result.chamber}:${result.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "exhibit-picker-option active" : "exhibit-picker-option"}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(result);
              }}
            >
              {renderIcon && <span className="exhibit-picker-icon">{renderIcon(result.chamber)}</span>}
              <span className="exhibit-picker-name">{result.name}</span>
            </div>
          ))}
          {showCreate && (
            <div
              role="option"
              aria-selected={activeIndex === results.length}
              className={
                activeIndex === results.length
                  ? "exhibit-picker-option exhibit-picker-create active"
                  : "exhibit-picker-option exhibit-picker-create"
              }
              onMouseEnter={() => setActiveIndex(results.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                createNew();
              }}
            >
              <span className="exhibit-picker-name">{creating ? "Creating —" : `+ Create "${trimmedQuery}"`}</span>
            </div>
          )}
          {error && <div className="exhibit-picker-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

interface LinksPanelProps {
  title: string;
  results: CapitolExhibitResolveResult[];
  emptyLabel: string;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  className: string;
  addControl?: ReactNode;
  removableIds?: Set<string>;
  onRemove?: (targetId: string) => void;
}

function LinksPanel({
  title,
  results,
  emptyLabel,
  renderIcon,
  onNavigate,
  className,
  addControl,
  removableIds,
  onRemove,
}: LinksPanelProps) {
  return (
    <aside className={className}>
      <h3 className="mb-2 flex flex-wrap items-center justify-between gap-y-2 font-mono text-xs uppercase tracking-wide text-dust">
        <span>
          {title} ({results.length})
        </span>
        {addControl}
      </h3>
      {results.length === 0 ? (
        <p className="font-mono text-sm text-dust">— {emptyLabel} —</p>
      ) : (
        <ul>
          {results.map((r) => (
            <li key={`${r.chamber}:${r.id}`} className="flex items-center gap-1 border-b border-dust py-2">
              <ExhibitChip
                result={r}
                renderIcon={renderIcon}
                onNavigate={onNavigate}
                className="exhibit-chip min-w-0 flex-1 font-mono text-sm"
              />
              {removableIds?.has(r.id) && onRemove && (
                <button
                  type="button"
                  className="exhibit-ref-remove tap-target"
                  onClick={() => onRemove(r.id)}
                  aria-label="Remove reference"
                  title="Remove reference"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

interface ExhibitLinksLayoutProps {
  exhibitId: string;
  emptyBacklinksLabel: string;
  emptyFrontlinksLabel: string;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<CapitolExhibitResolveResult, { url: string }>) => void;
  children: ReactNode;
  className?: string;
  // Explicit references, as opposed to ones embedded in body text - see
  // ManualRefsApi in @congress/chamber-kit. Omit all three to keep the
  // References panel purely read-only (the previous behavior).
  manualRefs?: string[];
  onAddReference?: (result: CapitolExhibitSearchResult) => void;
  onRemoveReference?: (targetId: string) => void;
  onCreateReference?: (title: string) => Promise<CapitolExhibitSearchResult>;
}

// Flanks its children with two panels backed by Capitol's exhibit_refs graph
// (the same table Exhibit Sharing's closure BFS walks): exhibits referencing
// this one on the left, exhibits this one references on the right - on
// desktop, at the sides of the content; on mobile, stacked below it as a
// two-column row instead (see .exhibit-links-layout in styles.css).
export function ExhibitLinksLayout({
  exhibitId,
  emptyBacklinksLabel,
  emptyFrontlinksLabel,
  renderIcon,
  onNavigate,
  children,
  className,
  manualRefs,
  onAddReference,
  onRemoveReference,
  onCreateReference,
}: ExhibitLinksLayoutProps) {
  const { backlinks, frontlinks } = useExhibitLinks(exhibitId);
  const manualIds = manualRefs ? new Set(manualRefs) : undefined;

  return (
    <div className={["exhibit-links-layout", className].filter(Boolean).join(" ")}>
      <LinksPanel
        title="Referenced by"
        results={backlinks}
        emptyLabel={emptyBacklinksLabel}
        renderIcon={renderIcon}
        onNavigate={onNavigate}
        className="exhibit-links-panel-back"
      />
      <div className="exhibit-links-main">{children}</div>
      <LinksPanel
        title="References"
        results={frontlinks}
        emptyLabel={emptyFrontlinksLabel}
        renderIcon={renderIcon}
        onNavigate={onNavigate}
        className="exhibit-links-panel-front"
        removableIds={manualIds}
        onRemove={onRemoveReference}
        addControl={
          onAddReference && (
            <AddReferenceControl
              exhibitId={exhibitId}
              existingIds={new Set(frontlinks.map((r) => r.id))}
              onAdd={onAddReference}
              onCreate={onCreateReference}
              renderIcon={renderIcon}
            />
          )
        }
      />
    </div>
  );
}
