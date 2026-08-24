import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ExhibitRefEntry, CapitolExhibitSearchResult } from "@congress/shared-types";
import { ExhibitChip } from "./ExhibitChip.js";
import { useExhibitConnections } from "./useExhibitConnections.js";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { useKeyboardInset } from "./useKeyboardInset.js";
import { addExhibitConnection, removeExhibitConnection } from "./exhibitRefs.js";

interface AddReferenceControlProps {
  exhibitId: string | null;
  existingIds: Set<string>;
  onAdd: (result: CapitolExhibitSearchResult) => Promise<void>;
  onCreate?: (title: string) => Promise<CapitolExhibitSearchResult>;
  renderIcon?: (chamber: string) => ReactNode;
}

// The "+" trigger in a links panel header - an explicit way to attach a
// reference to (or from) another Exhibit without writing a "[[" token in
// body text, for Exhibits that either have no natural text area or where a
// reference doesn't belong inline. Deliberately a separate, simpler control
// from useExhibitPicker/ExhibitPickerDropdown (no textarea, no caret math)
// even though the search/create/keyboard-nav shape mirrors it closely.
function AddReferenceControl({ exhibitId, existingIds, onAdd, onCreate, renderIcon }: AddReferenceControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
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

  // Kept open on failure (e.g. the target Chamber hasn't adopted
  // "/api/exhibits/:id/refs" yet) so the error message has somewhere to
  // render and the query isn't lost.
  function select(result: CapitolExhibitSearchResult) {
    setBusy(true);
    setError(null);
    onAdd(result)
      .then(() => close())
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to add reference"))
      .finally(() => setBusy(false));
  }

  function createNew() {
    if (!onCreate || !trimmedQuery) return;
    setBusy(true);
    setError(null);
    onCreate(trimmedQuery)
      .then((result) => onAdd(result).then(() => close()))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to create"))
      .finally(() => setBusy(false));
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
  // independent of the header row's flex layout - a links panel is only
  // 12rem wide on desktop (see .exhibit-links-panel-front/-back) and a
  // narrow stacked half-column on mobile, either of which would otherwise
  // squeeze a flex sibling <input> down to a sliver instead of giving it
  // room to be usable. Same fixed-above-keyboard treatment as
  // ExhibitPickerDropdown on mobile.
  const popoverStyle: Record<string, string> = {};
  if (keyboardInset > 0) popoverStyle.bottom = `calc(0.5rem + ${keyboardInset}px)`;

  return (
    <div className="exhibit-ref-add">
      <div className="exhibit-ref-add-popover docked-sheet" style={Object.keys(popoverStyle).length > 0 ? popoverStyle : undefined}>
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
              <span className="exhibit-picker-name">{busy ? "Working —" : `+ Create "${trimmedQuery}"`}</span>
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
  results: ExhibitRefEntry[];
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<ExhibitRefEntry, { url: string }>) => void;
  className: string;
  addControl?: ReactNode;
  onRemove?: (entry: ExhibitRefEntry) => void;
}

function LinksPanel({ title, results, renderIcon, onNavigate, className, addControl, onRemove }: LinksPanelProps) {
  return (
    <aside className={className}>
      <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-dust">{title}</h3>
      {results.length === 0 ? (
        <p className="font-mono text-sm text-dust">—</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={`${r.chamber}:${r.id}`} className="flex items-center gap-1">
              <ExhibitChip
                result={r}
                renderIcon={renderIcon}
                onNavigate={onNavigate}
                className="exhibit-chip min-w-0 flex-1 font-mono text-sm"
              />
              {r.isManual && onRemove && (
                <button
                  type="button"
                  className="exhibit-ref-remove tap-target"
                  onClick={() => onRemove(r)}
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
      {addControl && <div className="mt-2">{addControl}</div>}
    </aside>
  );
}

interface ExhibitLinksLayoutProps {
  // `null` = this Exhibit hasn't been created yet (a "New X" page rendering
  // the same layout as editing an existing one, before the first save) -
  // Connections are staged in `draftConnections` instead of coming from
  // Capitol's exhibit_refs graph. See `draftConnections`/
  // `onDraftConnectionsChange` below and `flushDraftConnections` in
  // exhibitRefs.ts, which applies them for real once a create mutation
  // returns the exhibit's real id.
  exhibitId: string | null;
  renderIcon?: (chamber: string) => ReactNode;
  onNavigate?: (result: Extract<ExhibitRefEntry, { url: string }>) => void;
  children: ReactNode;
  // The page's own action bar (Edit/Delete/Share/...) - kept separate from
  // `children` rather than just the last thing rendered in them, so it can
  // sit *after* the reference panels instead of before them (see
  // .exhibit-links-layout's grid-template-areas: content, then references,
  // then actions last - nobody scans past the actions of a note they
  // haven't finished reading the references of yet).
  actions?: ReactNode;
  className?: string;
  // Turns on the "+"/"×" controls on the Connections panel - adding a
  // connection writes an outgoing ref from this Exhibit (via Capitol's
  // proxy, see exhibitRefs.ts). Omit to keep the panel read-only (the
  // previous behavior).
  editable?: boolean;
  // Only a Chamber whose own Exhibits can be quick-created (Notes, today)
  // passes this - shows "+ Create <query>" in the add popover.
  onCreateReference?: (title: string) => Promise<CapitolExhibitSearchResult>;
  // Required together, only while `exhibitId` is null - the connections
  // picked so far on a not-yet-created Exhibit, held in the caller's own
  // state (not this component's) so its create mutation can read them back
  // and flush them for real via flushDraftConnections once it has a real id.
  draftConnections?: CapitolExhibitSearchResult[];
  onDraftConnectionsChange?: (next: CapitolExhibitSearchResult[]) => void;
}

// Flanks its children with a single panel backed by Capitol's exhibit_refs
// graph - every Exhibit connected to this one, undirected: no
// differentiation of whether this one or the other one established the
// connection. On desktop, at the side of the content; on mobile, stacked
// below it (see .exhibit-links-layout in styles.css).
export function ExhibitLinksLayout({
  exhibitId,
  renderIcon,
  onNavigate,
  children,
  actions,
  className,
  editable,
  onCreateReference,
  draftConnections,
  onDraftConnectionsChange,
}: ExhibitLinksLayoutProps) {
  const queryClient = useQueryClient();
  const persistedConnections = useExhibitConnections(exhibitId);
  const connections: ExhibitRefEntry[] =
    exhibitId === null
      ? (draftConnections ?? []).map((r) => ({ id: r.id, chamber: r.chamber, name: r.name, url: r.url, isManual: true }))
      : persistedConnections;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["exhibit-connections", exhibitId] });
  }

  // The picked result's chamber is passed through so Capitol can eagerly
  // cache it if it's never been created/edited within Congress before (e.g.
  // a pre-existing Google Calendar event) - see addExhibitConnection's own
  // comment. When `exhibitId` is still null, nothing is written yet - just
  // staged in the caller's own state, same shape flushDraftConnections
  // expects once a create mutation hands it a real id.
  async function addConnection(result: CapitolExhibitSearchResult) {
    if (exhibitId === null) {
      const staged = draftConnections ?? [];
      if (!staged.some((r) => r.id === result.id)) onDraftConnectionsChange?.([...staged, result]);
      return;
    }
    await addExhibitConnection(exhibitId, result.id, result.chamber);
    refresh();
  }
  async function removeConnection(entry: ExhibitRefEntry) {
    if (exhibitId === null) {
      onDraftConnectionsChange?.((draftConnections ?? []).filter((r) => r.id !== entry.id));
      return;
    }
    await removeExhibitConnection(exhibitId, entry.id);
    refresh();
  }

  return (
    <div className={["exhibit-links-layout", className].filter(Boolean).join(" ")}>
      <div className="exhibit-links-main">{children}</div>
      <div className="exhibit-links-divider" aria-hidden="true" />
      <LinksPanel
        title="Connections"
        results={connections}
        renderIcon={renderIcon}
        onNavigate={onNavigate}
        className="exhibit-links-panel-connections"
        onRemove={editable ? removeConnection : undefined}
        addControl={
          editable && (
            <AddReferenceControl
              exhibitId={exhibitId}
              existingIds={new Set(connections.map((r) => r.id))}
              onAdd={addConnection}
              onCreate={onCreateReference}
              renderIcon={renderIcon}
            />
          )
        }
      />
      {actions && <div className="exhibit-links-actions">{actions}</div>}
    </div>
  );
}
