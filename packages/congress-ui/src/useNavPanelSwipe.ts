import { useEffect, useRef, useState } from "react";

// How close to the left edge (px) a touch has to start before it's eligible
// to open the panel - keeps this from hijacking horizontal gestures
// elsewhere on screen (list rows, carousels). Mirrors the "reserved gesture
// space" comment on `overscroll-behavior-x: none` in styles.css - iOS's own
// edge-swipe-back gesture used to live here and is now disabled in favor of
// this one (belt-and-suspenders with the `preventDefault` below - the CSS
// property alone doesn't reliably win the race against the native gesture
// recognizer on every iOS version/mode).
const EDGE_ZONE_PX = 24;
// Matches `min(80vw, 18rem)` in styles.css's `.nav-panel-mobile` - used only
// before the panel has ever been measured (its ref not attached yet).
const PANEL_WIDTH_FALLBACK_PX = 288;
// Fraction of the panel's own width the finger has to have dragged past,
// at release, for the gesture to resolve to "open" (or stay open) rather
// than snap back - the standard drawer/bottom-sheet heuristic, and why this
// replaces the old fixed-pixel open/close thresholds now that the panel
// tracks the finger continuously instead of jumping the instant a fixed
// distance is crossed.
const SNAP_OPEN_RATIO = 0.5;

// Mobile-only off-canvas open/close state for NavPanel, driven by a
// right-swipe from the screen's left edge to open and a left-swipe (from
// anywhere on the open panel/backdrop) to close - there's no persistent
// toggle button. Desktop's own NavPanel variant is always visible via CSS
// alone and never reads `open`/`dragOffsetPx`/`dragProgress`, so this hook
// is harmless (if unused) there.
//
// While a gesture is active, `dragOffsetPx`/`dragProgress` track the raw
// finger position every touchmove so the panel/backdrop can be driven
// directly by an inline style that follows the finger 1:1, instead of
// jumping to fully open/closed the moment a threshold is crossed - `open`
// itself only updates once, on release, based on which side of
// `SNAP_OPEN_RATIO` the finger ended up on.
export function useNavPanelSwipe(): {
  open: boolean;
  // translateX value (px, <= 0) for the panel while actively dragging; null
  // when not dragging, so CSS's own `data-open` transition takes back over.
  dragOffsetPx: number | null;
  // 0 (closed) to 1 (open) while actively dragging; null when not dragging.
  dragProgress: number | null;
  panelRef: (el: HTMLElement | null) => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const panelElRef = useRef<HTMLElement | null>(null);
  const panelWidthRef = useRef(PANEL_WIDTH_FALLBACK_PX);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const trackingRef = useRef(false);
  const offsetRef = useRef(0);
  const [dragOffsetPx, setDragOffsetPx] = useState<number | null>(null);
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  function updateDrag(offset: number) {
    offsetRef.current = offset;
    const width = panelWidthRef.current;
    setDragOffsetPx(offset - width);
    setDragProgress(width > 0 ? offset / width : 0);
  }

  function endDrag() {
    trackingRef.current = false;
    startRef.current = null;
    setDragOffsetPx(null);
    setDragProgress(null);
  }

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      if (!openRef.current && touch.clientX > EDGE_ZONE_PX) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      trackingRef.current = true;
      panelWidthRef.current = panelElRef.current?.getBoundingClientRect().width || PANEL_WIDTH_FALLBACK_PX;
      updateDrag(openRef.current ? panelWidthRef.current : 0);
    }

    function onTouchMove(e: TouchEvent) {
      if (!trackingRef.current || !startRef.current) return;
      const touch = e.touches[0]!;
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      // Once this reads as more vertical than horizontal, it's a scroll, not
      // a nav-panel swipe - stop tracking it rather than fighting the page.
      if (Math.abs(dy) > Math.abs(dx) * 1.5) {
        endDrag();
        return;
      }
      // This is what actually stops iOS's own edge-swipe-back gesture from
      // firing alongside ours - a recognized horizontal drag owns the touch
      // sequence outright rather than racing the native gesture recognizer.
      if (e.cancelable) e.preventDefault();
      const width = panelWidthRef.current;
      const base = openRef.current ? width : 0;
      updateDrag(Math.min(width, Math.max(0, base + dx)));
    }

    function onTouchEnd() {
      if (trackingRef.current) {
        const width = panelWidthRef.current;
        setOpen(width > 0 && offsetRef.current / width > SNAP_OPEN_RATIO);
      }
      endDrag();
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return {
    open,
    dragOffsetPx,
    dragProgress,
    panelRef: (el) => {
      panelElRef.current = el;
    },
    close: () => setOpen(false),
  };
}
