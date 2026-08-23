import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { GlobalExhibitSearch } from "./GlobalExhibitSearch.js";
import { usePullGesture } from "./usePullGesture.js";
import { clearAppCaches } from "./queryPersistence.js";

interface MobileSearchRevealProps {
  ownChamber: string;
  navigate: (path: string) => void;
  renderIcon?: (chamber: string) => ReactNode;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="1.1em" height="1.1em">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="1.1em" height="1.1em">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

// Mobile-only stand-in for the global search bar (hidden below 641px, see
// .global-search) - a phone screen has no room for a search field in the
// header, so this reclaims the pull-down gesture space a standalone PWA's
// missing native pull-to-refresh leaves unused instead: a short pull down
// from the top of the page reveals a search icon (release opens the
// field), a longer pull swaps it to a refresh icon (release does a hard
// refresh - see clearAppCaches - not just window.location.reload() on its
// own, which given this app's IndexedDB-persisted query cache and the
// service worker's cache-first shell would otherwise still hand back
// whatever was cached instantly, then only silently revalidate in the
// background).
export function MobileSearchReveal({ ownChamber, navigate, renderIcon }: MobileSearchRevealProps) {
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef<HTMLDivElement>(null);

  const { zone, progress } = usePullGesture({
    onRelease: (released) => {
      if (released === "refresh") {
        // Best-effort and time-boxed internally (see clearAppCaches) -
        // reload always happens, whether or not clearing finished cleanly.
        void clearAppCaches().finally(() => window.location.reload());
      } else if (released === "search") {
        // flushSync + an immediate (not rAF-deferred) focus() call keeps
        // the whole thing inside the touchend handler's own call stack -
        // mobile browsers only raise the on-screen keyboard for a focus()
        // that happens synchronously within a trusted user gesture, and a
        // requestAnimationFrame callback runs a task too late to still
        // count as one.
        flushSync(() => setExpanded(true));
        expandedRef.current?.querySelector("input")?.focus();
      }
    },
  });

  // Tapping anywhere outside the expanded search bar dismisses it, same as
  // ExhibitPickerDropdown's own click-away handling.
  useEffect(() => {
    if (!expanded) return;
    function onOutsideDown(e: MouseEvent) {
      if (!(e.target instanceof Node) || expandedRef.current?.contains(e.target)) return;
      setExpanded(false);
    }
    document.addEventListener("mousedown", onOutsideDown);
    return () => document.removeEventListener("mousedown", onOutsideDown);
  }, [expanded]);

  if (expanded) {
    return (
      <div
        className="mobile-search-reveal-expanded"
        ref={expandedRef}
        onBlur={(e) => {
          // Losing focus entirely - not just moving between the input and
          // the close button - means the on-screen keyboard just closed
          // (tapped its own dismiss control, swiped it away, ...). There's
          // nothing left to type into a search field with no keyboard, so
          // collapse back to the pull-indicator instead of leaving an inert
          // bar open. The delay mirrors GlobalExhibitSearch's own blur
          // handling, though it rarely matters here: a result click never
          // blurs the input (its onMouseDown already calls preventDefault),
          // and select() blurs explicitly once it's done navigating.
          const next = e.relatedTarget;
          if (next instanceof Node && e.currentTarget.contains(next)) return;
          setTimeout(() => setExpanded(false), 150);
        }}
      >
        <GlobalExhibitSearch ownChamber={ownChamber} navigate={navigate} renderIcon={renderIcon} />
        <button
          type="button"
          className="mobile-search-reveal-close tap-target"
          onClick={() => setExpanded(false)}
          aria-label="Close search"
        >
          ×
        </button>
      </div>
    );
  }

  if (zone === "idle") return null;

  return (
    <div className="mobile-pull-indicator" data-zone={zone} style={{ opacity: Math.min(1, progress * 2) }} aria-hidden="true">
      {zone === "refresh" ? <RefreshIcon /> : <SearchIcon />}
    </div>
  );
}
