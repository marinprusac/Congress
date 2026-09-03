import { useEffect, useRef, useState } from "react";

// How close to the left edge (px) a touch has to start to be treated as the
// dedicated edge-swipe gesture, which gets its own touchstart-time
// preventDefault (see onTouchStart) to win the race against the platform's
// own edge-swipe-back recognizer - see that comment for why this is still
// worth keeping as a distinct, narrower zone even now that opening also
// works from anywhere (below).
const EDGE_ZONE_PX = 24;
// Below this, a horizontal drag is still ambiguous with normal touch jitter
// (a slightly-off-axis tap, a finger settling before a vertical scroll) -
// only once a from-anywhere drag clears this many px horizontally do we
// treat it as a deliberate swipe and start stealing the touch sequence.
// The dedicated edge zone above skips this - starting a drag that close to
// the edge is already unambiguous intent.
const ANYWHERE_COMMIT_PX = 12;

// Whether a from-anywhere touch should be left alone rather than tracked as
// a candidate nav-panel-open swipe: an element that opted out explicitly
// (a full-bleed map, which wants its own pan/zoom to own every drag on it -
// see data-nav-swipe-ignore in the Map chamber), a text input (a rightward
// drag there is placing a cursor/selecting, not swiping), or anything
// that's natively horizontally scrollable itself (a wide table, a code
// block - `.note-prose pre`/`.note-table-wrapper` and friends), which
// already owns this same gesture for its own scrolling. The dedicated edge
// zone skips this check entirely - it's narrow enough, and the gesture
// space it uses was already reserved for it (see `overscroll-behavior-x` in
// styles.css), that nothing legitimate lives there to protect.
function isNavSwipeIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-nav-swipe-ignore], input, textarea, select, [contenteditable]")) return true;
  let el: Element | null = target;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}
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
// right-swipe to open - from the screen's left edge reliably, or from
// anywhere else on screen once the drag clearly reads as horizontal - and a
// left-swipe (from anywhere on the open panel/backdrop) to close - there's
// no persistent toggle button. Desktop's own NavPanel variant is always
// visible via CSS alone and never reads `open`/`dragOffsetPx`/`dragProgress`,
// so this hook is harmless (if unused) there.
//
// The from-anywhere case has to stay opt-out-able: a full-bleed surface with
// its own horizontal drag meaning (the Map chamber's pan/zoom) tags itself
// `data-nav-swipe-ignore` to keep this window-level listener from stealing
// the touch out from under it; a genuinely horizontally-scrollable element
// (a wide table, a code block) is detected and left alone the same way,
// without needing its own opt-out tag.
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
  // True once a from-anywhere drag has cleared ANYWHERE_COMMIT_PX and this
  // hook has actually started stealing the touch sequence (preventDefault).
  // The dedicated edge-zone gesture skips this - it commits immediately, on
  // touchstart itself, since starting a drag right at the edge is already
  // unambiguous (and has to preventDefault that early to beat the native
  // edge-swipe-back recognizer - see onTouchStart).
  const committedRef = useRef(false);
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
    committedRef.current = false;
    startRef.current = null;
    setDragOffsetPx(null);
    setDragProgress(null);
  }

  useEffect(() => {
    // A non-passive touchmove listener tells the browser it may call
    // preventDefault, which forces the compositor to wait for this handler
    // before it can scroll *anything* in the app - not just this gesture.
    // Registered only for the lifetime of a qualifying drag (added once
    // onTouchStart accepts it, removed on release) instead of for the
    // whole mounted lifetime of this hook, so every other scroll in the app
    // stays compositor-only the rest of the time.
    function stopTracking() {
      window.removeEventListener("touchmove", onTouchMove);
      endDrag();
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      const closed = !openRef.current;
      const inEdgeZone = touch.clientX <= EDGE_ZONE_PX;
      // Outside the dedicated edge zone, opening from anywhere still has to
      // stay out of the way of anything with its own meaning for a
      // horizontal drag - see isNavSwipeIgnored.
      if (closed && !inEdgeZone && isNavSwipeIgnored(e.target)) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      trackingRef.current = true;
      panelWidthRef.current = panelElRef.current?.getBoundingClientRect().width || PANEL_WIDTH_FALLBACK_PX;
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      // Closing an open panel, or opening right from the edge, is
      // unambiguous the instant the touch lands - commit immediately rather
      // than waiting for movement like the from-anywhere case below does.
      // This only decides how far updateDrag's baseline tracking starts
      // from, not whether to preventDefault - see below for why those two
      // are kept separate.
      committedRef.current = !closed || inEdgeZone;
      if (committedRef.current) {
        updateDrag(openRef.current ? panelWidthRef.current : 0);
      }
      // Only the dedicated edge-zone *open* preventDefaults this early, on
      // touchstart itself rather than touchmove - that's what actually
      // stops the platform's own edge-swipe-back gesture from firing
      // alongside ours, since it decides whether to claim the touch based
      // on whether anything already has, before the finger even moves.
      // Doing the same for "panel already open" - even though that case
      // also commits immediately, just for updateDrag's sake above - would
      // preventDefault on every ordinary tap anywhere inside the open
      // panel, including on a chamber row: a stationary tap never reaches
      // onTouchMove at all, so touchstart is the only place that could
      // still swallow its click, and on mobile a prevented touchstart does
      // exactly that (confirmed live - this broke every chamber icon in
      // the open panel until caught). Closing was never competing with the
      // native edge gesture anyway (it doesn't start at the edge), so it's
      // fine to wait for real horizontal movement in onTouchMove instead,
      // same as the from-anywhere open case already does.
      if (inEdgeZone) {
        if (e.cancelable) e.preventDefault();
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!trackingRef.current || !startRef.current) return;
      const touch = e.touches[0]!;
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;
      // Once this reads as more vertical than horizontal, it's a scroll, not
      // a nav-panel swipe - stop tracking it rather than fighting the page.
      if (Math.abs(dy) > Math.abs(dx) * 1.5) {
        stopTracking();
        return;
      }
      if (!committedRef.current) {
        // A from-anywhere drag: still deciding. Below the commit threshold,
        // this is indistinguishable from tap jitter - leave the page alone
        // and keep watching. A leftward drag has no meaning while the panel
        // is closed (there's nothing to close), so once it's unambiguous
        // it's just abandoned rather than committed to.
        if (Math.abs(dx) < ANYWHERE_COMMIT_PX) return;
        if (dx <= 0) {
          stopTracking();
          return;
        }
        committedRef.current = true;
      }
      if (e.cancelable) e.preventDefault();
      const width = panelWidthRef.current;
      const base = openRef.current ? width : 0;
      updateDrag(Math.min(width, Math.max(0, base + dx)));
    }

    function onTouchEnd() {
      // trackingRef is true for every touchstart, including a plain tap that
      // never moved - only a touch that actually committed to a drag (real
      // movement past ANYWHERE_COMMIT_PX, or the immediate-commit close/edge-
      // open cases) should resolve `open` here. Without this check, a tap
      // that never committed still fell through to this branch and resolved
      // `open` from offsetRef.current - which isn't reset between gestures,
      // so it silently reused whatever offset the *last* committed drag left
      // behind (e.g. a full-width offset from closing the panel), reopening
      // it on the next unrelated tap anywhere on screen.
      if (trackingRef.current && committedRef.current) {
        const width = panelWidthRef.current;
        setOpen(width > 0 && offsetRef.current / width > SNAP_OPEN_RATIO);
      }
      stopTracking();
    }

    // Non-passive so the edge-zone case above can preventDefault
    // synchronously on touchstart itself - see the comment there. Every
    // other touchstart in the app still costs almost nothing: a non-passive
    // *touchstart* listener that doesn't call preventDefault doesn't block
    // the compositor the way a non-passive touchmove would (that's the
    // per-drag touchmove listener's own concern, addressed by its own
    // "registered only for the lifetime of a qualifying drag" comment
    // above).
    window.addEventListener("touchstart", onTouchStart, { passive: false });
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
