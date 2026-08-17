import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CapitolExhibitSearchResult } from "@congress/shared-types";
import { useExhibitSearch } from "./useExhibitSearch.js";
import { navigateToExhibit } from "./navigateToExhibit.js";
import { useShellHosted } from "./ShellHostContext.js";

interface GlobalExhibitSearchProps {
  // Passed to navigateToExhibit - the chamber this search bar is mounted
  // in (so a result from that same chamber uses the local router instead
  // of a full page load), or "" for Capitol, which owns no exhibits of its
  // own and should always navigate to the target chamber's app.
  ownChamber: string;
  navigate: (path: string) => void;
  renderIcon?: (chamber: string) => ReactNode;
  className?: string;
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return (el as HTMLElement).isContentEditable;
}

// A single search bar reachable from every Congress frontend (mounted once
// in CapitolHeader and once in ChamberLayout, so it's present on every
// page), fanning a query out to every registered Chamber via Capitol's
// existing /congress/exhibits/search endpoint and merging the results -
// letting any note, event, or document be found without knowing which
// Chamber owns it. Pressing "/" anywhere outside an editable field focuses
// it, mirroring the "[[" picker's own type-ahead/arrow-key/enter
// interaction (see useExhibitPicker) so the pattern is already familiar.
export function GlobalExhibitSearch({ ownChamber, navigate, renderIcon, className }: GlobalExhibitSearchProps) {
  const shellHosted = useShellHosted();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { results, loading } = useExhibitSearch(query, open);

  useEffect(() => setActiveIndex(0), [results]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function select(result: CapitolExhibitSearchResult) {
    navigateToExhibit(ownChamber, result, navigate, shellHosted);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className={className ? `${className} global-search` : "global-search"}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        // A timeout, not an immediate close - lets a result's onMouseDown
        // (which calls select before this fires) win the race, same
        // pattern RootPicker/ExhibitPickerDropdown already use.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
            return;
          }
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            const active = results[activeIndex];
            if (active) {
              e.preventDefault();
              select(active);
            }
          }
        }}
        placeholder="Search Congress —"
        aria-label="Search Congress"
        className="global-search-input"
      />
      {!open && !query && (
        <kbd className="global-search-hint" aria-hidden="true">
          /
        </kbd>
      )}
      <div className="global-search-dropdown" role="listbox" hidden={!open}>
        {loading && results.length === 0 && <div className="exhibit-picker-empty">Searching —</div>}
        {!loading && results.length === 0 && (
          <div className="exhibit-picker-empty">
            {query.trim() ? "No matches" : "— Type to search every Chamber —"}
          </div>
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
      </div>
    </div>
  );
}
